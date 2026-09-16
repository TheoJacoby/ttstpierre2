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

const KEY = 'data';
const MAX_SCORE = 16;      // un interclub = 16 matchs
const MAX_VICTOIRES = 4;   // 4 simples par joueur
const MAX_JOUEURS = 4;

/** Erreur "métier" renvoyée telle quelle à l'utilisateur (HTTP 400). */
class ValidationError extends Error {}
const invalid = (msg) => new ValidationError(msg);

export default {
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
    return withData(env, (data) => applyScore(data, body));
  }

  if (path === '/api/admin') {
    const role = roleFor(body.password, env);
    if (role !== 'admin') return json({ ok: false, error: 'Mot de passe administrateur incorrect' }, 401);
    switch (body.action) {
      case 'score':    return withData(env, (data) => applyScore(data, body));
      case 'journee':  return withData(env, (data) => applyJournee(data, body));
      case 'equipes':  return withData(env, (data) => applyEquipes(data, body));
      case 'extras':   return withData(env, (data) => applyExtras(data, body));
      case 'restore':  return withData(env, () => restore(body));
      case 'reset':    return withData(env, () => structuredClone(seed));
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
  return stored || structuredClone(seed);
}

async function withData(env, mutate) {
  const data = await loadData(env);
  const result = mutate(data);           // lève une Error avec un message lisible si invalide
  const next = result || data;
  next.updatedAt = new Date().toISOString();
  await env.DATA.put(KEY, JSON.stringify(next));
  return json({ ok: true, data: next });
}

/* ---------- Actions ---------- */

function applyScore(data, body) {
  const match = (data.journee?.matchs || []).find((m) => m.equipe === body.equipe);
  if (!match) throw invalid(`Aucun match pour ${body.equipe} cette journée`);

  const forfait = body.forfait === 'sp' || body.forfait === 'adv' ? body.forfait : null;

  if (forfait) {
    match.forfait = forfait;
    match.score_sp = forfait === 'adv' ? MAX_SCORE : 0;
    match.score_adv = forfait === 'adv' ? 0 : MAX_SCORE;
    match.joueurs = [];
    match.maj = new Date().toISOString();
    return data;
  }

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
  const scoreSp = cleaned.reduce((s, j) => s + j.victoires, 0);
  if (scoreSp + scoreAdv > MAX_SCORE) throw invalid(`Total ${scoreSp + scoreAdv} > ${MAX_SCORE} : vérifie les victoires`);
  if (scoreSp + scoreAdv === 0 && cleaned.length === 0) {
    // remise à zéro explicite
    match.score_sp = null; match.score_adv = null; match.joueurs = []; match.forfait = null;
    match.maj = new Date().toISOString();
    return data;
  }

  match.forfait = null;
  match.score_sp = scoreSp;
  match.score_adv = scoreAdv;
  match.joueurs = cleaned;
  match.maj = new Date().toISOString();

  // Mémorise les nouveaux noms dans la liste du club (pratique pour l'autocomplétion)
  const club = new Set(data.joueurs_club || []);
  cleaned.forEach((j) => club.add(j.nom));
  data.joueurs_club = [...club].sort((a, b) => a.localeCompare(b, 'fr'));
  return data;
}

function applyJournee(data, body) {
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

  // Une journée qui a des scores part dans l'historique (remplace une éventuelle version du même numéro)
  const current = data.journee;
  if (current && current.matchs?.some((m) => m.score_sp !== null || m.score_adv !== null)) {
    data.historique = (data.historique || []).filter((j) => j.numero !== current.numero);
    data.historique.push(current);
    data.historique.sort((a, b) => a.numero - b.numero);
  }
  // Même numéro republié : on garde les scores déjà encodés pour les équipes inchangées
  if (current && current.numero === numero) {
    for (const m of matchs) {
      const old = current.matchs.find((o) => o.equipe === m.equipe && o.adversaire === m.adversaire);
      if (old) Object.assign(m, { score_sp: old.score_sp, score_adv: old.score_adv, forfait: old.forfait, joueurs: old.joueurs, maj: old.maj });
    }
    data.historique = (data.historique || []).filter((j) => j.numero !== numero);
  }

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
