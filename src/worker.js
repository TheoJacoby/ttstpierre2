/**
 * Worker Cloudflare du club TT Saint-Pierre.
 *
 *  - Sert les fichiers statiques de ./public (TV, page capitaine, page admin).
 *  - Expose une petite API JSON sous /api/* dont les données vivent dans le KV "DATA".
 *
 * Aucun token GitHub n'est nécessaire : les mots de passe sont des secrets Cloudflare
 * (CAPTAIN_PASSWORD, ADMIN_PASSWORD) et ne quittent jamais le serveur.
 */
import seed from '../data/seed.json';
import { aftt } from './aftt.js';

const KEY = 'data';
const KEY_CLASSEMENTS = 'classements';
/** Chaque score vit dans sa propre clé : deux capitaines n'écrivent jamais au même endroit. */
const scoreKey = (numero, equipe) => `score:${numero}:${equipe}`;
const SCORE_FIELDS = ['score_sp', 'score_adv', 'forfait', 'joueurs', 'maj'];
const MAX_SCORE = 16;      // un interclub = 16 matchs
const MAX_VICTOIRES = 4;   // 4 simples par joueur
const MAX_JOUEURS = 4;

/** Erreur "métier" renvoyée telle quelle à l'utilisateur (HTTP 400). */
class ValidationError extends Error {}
const invalid = (msg) => new ValidationError(msg);

export default {
  /** Tâche planifiée (voir wrangler.toml) : synchronise classements et membres, publie la semaine suivante si demandé */
  async scheduled(event, env) {
    const data = await loadData(env);
    try { await syncAftt(env, data); } catch (e) { console.error('sync fédération :', e.message); }
    if (data.aftt?.auto_import) {
      const today = new Date().toISOString().slice(0, 10);
      const cur = data.journee;
      const finie = cur.date < today || cur.matchs.some((m) => m.score_sp !== null);
      if (finie) {
        try { await applyJournee(env, data, await journeeDepuisAftt(data, cur.numero + 1)); } catch (e) { console.error('import auto :', e.message); }
      }
    }
    data.updatedAt = new Date().toISOString();
    await storeDoc(env, data);
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        if (err instanceof ValidationError) return json({ ok: false, error: err.message }, 400);
        console.error(err);
        return json({ ok: false, error: 'Erreur serveur : ' + (err.message || err) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  if (path === '/api/data' && request.method === 'GET') {
    const data = await loadData(env);
    return json({ ok: true, data });
  }

  if (request.method !== 'POST') return json({ ok: false, error: 'Méthode non autorisée' }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'JSON invalide' }, 400); }

  if (path === '/api/login') {
    const role = roleFor(body.password, env);
    if (!role) return json({ ok: false, error: 'Mot de passe incorrect' }, 401);
    return json({ ok: true, role });
  }

  if (path === '/api/capitaine') {
    const role = roleFor(body.password, env);
    if (!role) return json({ ok: false, error: 'Mot de passe incorrect' }, 401);
    if (body.action !== 'score') return json({ ok: false, error: 'Action inconnue' }, 400);
    return saveScore(env, body);
  }

  if (path === '/api/admin') {
    const role = roleFor(body.password, env);
    if (role !== 'admin') return json({ ok: false, error: 'Mot de passe administrateur incorrect' }, 401);
    switch (body.action) {
      case 'score':    return saveScore(env, body);
      case 'journee':  return withData(env, (data) => applyJournee(env, data, body));
      case 'equipes':  return withData(env, (data) => applyEquipes(data, body));
      case 'extras':   return withData(env, (data) => applyExtras(data, body));
      case 'restore':  return withData(env, async () => {
        await deleteAllScores(env);
        const d = restore(body);
        // Les scores de la journée en cours contenus dans la sauvegarde retrouvent leurs clés
        await Promise.all((d.journee.matchs || []).filter((m) => m.score_sp !== null).map((m) =>
          env.DATA.put(scoreKey(d.journee.numero, m.equipe), JSON.stringify(Object.fromEntries(SCORE_FIELDS.map((f) => [f, m[f] ?? null]))))));
        return d;
      });
      case 'reset':    return withData(env, async () => { await deleteAllScores(env); return structuredClone(seed); });
      case 'aftt_semaine': {                       // aperçu d'une semaine fédération, sans rien enregistrer
        const data = await loadData(env);
        return json({ ok: true, journee: await journeeDepuisAftt(data, body.semaine) });
      }
      case 'aftt_sync':   return withData(env, (data) => syncAftt(env, data));
      case 'aftt_config': return withData(env, (data) => { data.aftt = { ...(data.aftt || {}), auto_import: !!body.auto_import }; return data; });
      default:         return json({ ok: false, error: 'Action inconnue' }, 400);
    }
  }

  return json({ ok: false, error: 'Route inconnue' }, 404);
}

/* ---------- Authentification ---------- */

function roleFor(password, env) {
  if (typeof password !== 'string' || !password) return null;
  if (env.ADMIN_PASSWORD && safeEqual(password, env.ADMIN_PASSWORD)) return 'admin';
  if (env.CAPTAIN_PASSWORD && safeEqual(password, env.CAPTAIN_PASSWORD)) return 'capitaine';
  return null;
}

function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(a), bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

/* ---------- Lecture / écriture KV ---------- */

async function loadData(env) {
  const stored = await env.DATA.get(KEY, 'json');
  const data = stored || structuredClone(seed);
  const matchs = data.journee?.matchs || [];
  if (matchs.length) {
    const keys = matchs.map((m) => scoreKey(data.journee.numero, m.equipe));
    const scores = await env.DATA.get(keys, { type: 'json' });   // lecture groupée
    for (const m of matchs) {
      // Les clés sont la seule source de vérité : sans clé, pas de score
      const sc = scores.get(scoreKey(data.journee.numero, m.equipe)) || { score_sp: null, score_adv: null, forfait: null, joueurs: [], maj: null };
      SCORE_FIELDS.forEach((f) => { m[f] = sc[f] ?? (f === 'joueurs' ? [] : null); });
    }
  }
  data.classements = (await env.DATA.get(KEY_CLASSEMENTS, 'json')) || { maj: null, divisions: [] };
  // Les nouveaux noms encodés par les capitaines apparaissent dans la liste du club sans écrire le document
  const club = new Set(data.joueurs_club || []);
  matchs.forEach((m) => (m.joueurs || []).forEach((j) => club.add(j.nom)));
  data.joueurs_club = [...club].sort((a, b) => a.localeCompare(b, 'fr'));
  return data;
}

async function deleteScores(env, numero, equipes) {
  await Promise.all(equipes.map((e) => env.DATA.delete(scoreKey(numero, e))));
}

async function deleteAllScores(env) {
  let cursor;
  do {
    const page = await env.DATA.list({ prefix: 'score:', cursor });
    await Promise.all(page.keys.map((k) => env.DATA.delete(k.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

async function withData(env, mutate) {
  const data = await loadData(env);
  const result = await mutate(data);     // lève une ValidationError si invalide
  const next = result || data;
  next.updatedAt = new Date().toISOString();
  await storeDoc(env, next);
  return json({ ok: true, data: next });
}

async function storeDoc(env, data) {
  const toStore = structuredClone(data);
  // Les scores de la journée en cours vivent dans leurs propres clés, les classements aussi : pas de copie dans le document
  (toStore.journee?.matchs || []).forEach((m) => { m.score_sp = null; m.score_adv = null; m.forfait = null; m.joueurs = []; m.maj = null; });
  delete toStore.classements;
  await env.DATA.put(KEY, JSON.stringify(toStore));
}

/* ---------- Fédération (AFTT) ---------- */

const lettre = (equipe) => (String(equipe).match(/\s([A-Z])$/) || [])[1] || '';

/** Construit la journée d'une semaine fédération pour nos équipes (format attendu par applyJournee) */
async function journeeDepuisAftt(data, semaine) {
  const numero = toInt(semaine);
  if (numero === null || numero < 1 || numero > 30) throw invalid('Numéro de semaine invalide (1 à 22)');
  const club = data.aftt?.club || 'Lx108';
  const rencontres = await aftt.rencontres(club, numero);
  if (!rencontres.length) throw invalid(`Aucune rencontre trouvée pour la semaine ${numero}`);
  const samedis = rencontres.map((r) => r.date).filter((d) => new Date(d + 'T12:00:00').getDay() === 6);
  const date = (samedis.length ? samedis : rencontres.map((r) => r.date)).sort().pop();
  const matchs = data.equipes.map((equipe) => {
    const r = rencontres.find((x) => x.lettre === lettre(equipe));
    if (!r) return { equipe, adversaire: 'Bye', lieu: 'domicile', heure: '', date, note: '' };
    return { equipe, adversaire: r.adversaire, lieu: r.lieu, heure: r.heure, date: r.date, note: '' };
  });
  return { numero, date, matchs, source: 'aftt' };
}

/** Rafraîchit équipes, membres et classements depuis la fédération */
async function syncAftt(env, data) {
  const club = data.aftt?.club || 'Lx108';
  const [equipes, membres] = await Promise.all([aftt.equipes(club), aftt.membres(club)]);
  data.equipes_aftt = equipes.map((e) => ({ equipe: data.equipes.find((n) => lettre(n) === e.lettre) || `Saint-Pierre ${e.lettre}`, ...e }));
  data.joueurs_aftt = membres.sort((a, b) => a.position - b.position);
  const divisions = await Promise.all(equipes.map(async (e) => ({
    equipe: data.equipes.find((n) => lettre(n) === e.lettre) || `Saint-Pierre ${e.lettre}`,
    lettre: e.lettre, divisionId: e.divisionId, division: e.divisionCourte, nom: e.division,
    rows: await aftt.classement(e.divisionId),
  })));
  data.classements = { maj: new Date().toISOString(), divisions };
  await env.DATA.put(KEY_CLASSEMENTS, JSON.stringify(data.classements));
  data.aftt = { ...(data.aftt || {}), club, derniere_sync: data.classements.maj };
  return data;
}

/* ---------- Actions ---------- */

async function saveScore(env, body) {
  const data = await loadData(env);
  const match = (data.journee?.matchs || []).find((m) => m.equipe === body.equipe);
  if (!match) throw invalid(`Aucun match pour ${body.equipe} cette journée`);
  const key = scoreKey(data.journee.numero, match.equipe);

  const forfait = body.forfait === 'sp' || body.forfait === 'adv' ? body.forfait : null;
  let record;

  if (forfait) {
    record = { score_sp: forfait === 'adv' ? MAX_SCORE : 0, score_adv: forfait === 'adv' ? 0 : MAX_SCORE, forfait, joueurs: [], maj: new Date().toISOString() };
  } else {
    const joueurs = Array.isArray(body.joueurs) ? body.joueurs : [];
    if (joueurs.length > MAX_JOUEURS) throw invalid(`Maximum ${MAX_JOUEURS} joueurs`);
    const cleaned = [];
    const seen = new Set();
    for (const j of joueurs) {
      const nom = String(j?.nom || '').trim();
      if (!nom) continue;
      if (seen.has(nom.toLowerCase())) throw invalid(`Le joueur "${nom}" apparaît deux fois`);
      seen.add(nom.toLowerCase());
      const v = toInt(j.victoires);
      if (v === null || v < 0 || v > MAX_VICTOIRES) throw invalid(`Victoires invalides pour ${nom} (0 à ${MAX_VICTOIRES})`);
      cleaned.push({ nom, victoires: v });
    }
    const scoreAdv = toInt(body.score_adv);
    if (scoreAdv === null || scoreAdv < 0 || scoreAdv > MAX_SCORE) throw invalid(`Score adverse invalide (0 à ${MAX_SCORE})`);
    const scoreSp = cleaned.reduce((sum, j) => sum + j.victoires, 0);
    if (scoreSp + scoreAdv > MAX_SCORE) throw invalid(`Total ${scoreSp + scoreAdv} > ${MAX_SCORE} : vérifie les victoires`);

    if (scoreSp + scoreAdv === 0 && cleaned.length === 0) {
      await env.DATA.delete(key);                       // remise à zéro explicite
      SCORE_FIELDS.forEach((f) => { match[f] = f === 'joueurs' ? [] : null; });
      return json({ ok: true, data });
    }
    record = { score_sp: scoreSp, score_adv: scoreAdv, forfait: null, joueurs: cleaned, maj: new Date().toISOString() };
  }

  await env.DATA.put(key, JSON.stringify(record));
  Object.assign(match, record);
  record.joueurs.forEach((j) => { if (!data.joueurs_club.includes(j.nom)) data.joueurs_club.push(j.nom); });
  return json({ ok: true, data });
}

async function applyJournee(env, data, body) {
  const numero = toInt(body.numero);
  if (numero === null || numero < 1) throw invalid('Numéro de journée invalide');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date || ''))) throw invalid('Date invalide (AAAA-MM-JJ)');
  if (!Array.isArray(body.matchs)) throw invalid('Liste de matchs manquante');

  const matchs = body.matchs.map((m) => {
    if (!data.equipes.includes(m.equipe)) throw invalid(`Équipe inconnue : ${m.equipe}`);
    const date = String(m.date || body.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invalid(`Date invalide pour ${m.equipe}`);
    return {
      equipe: m.equipe,
      date,
      adversaire: String(m.adversaire || '').trim(),
      lieu: m.lieu === 'exterieur' ? 'exterieur' : 'domicile',
      heure: String(m.heure || '').trim(),
      note: String(m.note || '').trim(),
      score_sp: null, score_adv: null, forfait: null, joueurs: [], maj: null,
    };
  });

  const current = data.journee;   // déjà fusionnée avec les scores par équipe (loadData)
  const club = new Set(data.joueurs_club || []);

  if (current && current.numero === numero) {
    // Même numéro republié : on garde les scores des équipes dont l'adversaire n'a pas changé
    const changed = current.matchs.filter((o) => {
      const n = matchs.find((m) => m.equipe === o.equipe);
      return !n || n.adversaire !== o.adversaire;
    }).map((o) => o.equipe);
    await deleteScores(env, numero, changed);
    for (const m of matchs) {
      const old = current.matchs.find((o) => o.equipe === m.equipe && o.adversaire === m.adversaire);
      if (old) SCORE_FIELDS.forEach((f) => { m[f] = old[f]; });
    }
    data.historique = (data.historique || []).filter((j) => j.numero !== numero);
  } else if (current) {
    // Nouvelle journée : l'ancienne part dans l'historique si elle a des scores, ses clés sont nettoyées
    if (current.matchs?.some((m) => m.score_sp !== null || m.score_adv !== null)) {
      data.historique = (data.historique || []).filter((j) => j.numero !== current.numero);
      data.historique.push(current);
      data.historique.sort((a, b) => a.numero - b.numero);
    }
    await deleteScores(env, current.numero, current.matchs.map((m) => m.equipe));
  }
  data.joueurs_club = [...club].sort((a, b) => a.localeCompare(b, 'fr'));

  data.journee = { numero, date: body.date, matchs };

  const adv = new Set(data.adversaires_connus || []);
  matchs.forEach((m) => { if (m.adversaire && !/^bye$/i.test(m.adversaire)) adv.add(m.adversaire); });
  data.adversaires_connus = [...adv].sort((a, b) => a.localeCompare(b, 'fr'));
  return data;
}

function applyEquipes(data, body) {
  if (!Array.isArray(body.equipes) || !body.equipes.length) throw invalid('Il faut au moins une équipe');
  const equipes = body.equipes.map((e) => String(e).trim()).filter(Boolean);
  const titulaires = {};
  for (const e of equipes) {
    const list = Array.isArray(body.titulaires?.[e]) ? body.titulaires[e] : [];
    titulaires[e] = list.map((n) => String(n).trim()).filter(Boolean).slice(0, MAX_JOUEURS);
  }
  const club = new Set((body.joueurs_club || data.joueurs_club || []).map((n) => String(n).trim()).filter(Boolean));
  Object.values(titulaires).flat().forEach((n) => club.add(n));

  data.equipes = equipes;
  data.titulaires = titulaires;
  data.vendredi_domicile = (Array.isArray(body.vendredi_domicile) ? body.vendredi_domicile : data.vendredi_domicile || []).filter((e) => equipes.includes(e));
  data.joueurs_club = [...club].sort((a, b) => a.localeCompare(b, 'fr'));
  // Garde la journée cohérente avec la liste d'équipes
  if (data.journee) {
    data.journee.matchs = data.journee.matchs.filter((m) => equipes.includes(m.equipe));
    for (const e of equipes) {
      if (!data.journee.matchs.some((m) => m.equipe === e)) {
        data.journee.matchs.push({ equipe: e, date: data.journee.date, adversaire: '', lieu: 'domicile', heure: '', note: '', score_sp: null, score_adv: null, forfait: null, joueurs: [], maj: null });
      }
    }
    data.journee.matchs.sort((a, b) => equipes.indexOf(a.equipe) - equipes.indexOf(b.equipe));
  }
  return data;
}

function applyExtras(data, body) {
  if (body.joueur_du_mois) {
    const j = body.joueur_du_mois;
    data.joueur_du_mois = {
      mode: j.mode === 'manuel' ? 'manuel' : 'auto',
      nom: String(j.nom || '').trim(),
      victoires: toInt(j.victoires) ?? 0,
      performances: toInt(j.performances) ?? 0,
      points: toInt(j.points) ?? 0,
      mois: String(j.mois || '').trim(),
      genre: j.genre === 'F' ? 'F' : 'H',
    };
  }
  if (Array.isArray(body.meilleures_perfs)) {
    data.meilleures_perfs = body.meilleures_perfs
      .map((p) => ({ nom: String(p.nom || '').trim(), points: toInt(p.points) ?? 0 }))
      .filter((p) => p.nom)
      .slice(0, 6);
  }
  if (Array.isArray(body.annonces)) {
    data.annonces = body.annonces
      .map((a) => ({ texte: String(a.texte || '').trim(), fin: /^\d{4}-\d{2}-\d{2}$/.test(a.fin || '') ? a.fin : '' }))
      .filter((a) => a.texte)
      .slice(0, 10);
  }
  return data;
}

function restore(body) {
  const d = body.data;
  if (!d || typeof d !== 'object' || !Array.isArray(d.equipes) || !d.journee) throw invalid('Sauvegarde invalide');
  return d;
}

/* ---------- Utilitaires ---------- */

function toInt(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders() },
  });
}
