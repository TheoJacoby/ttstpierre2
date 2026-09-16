/**
 * Accès aux données de la fédération, avec deux sources :
 *  - l'API TabT (api.aftt.be, SOAP) : complète, mais elle refuse les requêtes venant du réseau Cloudflare ;
 *  - le site data.aftt.be (pages HTML) : joignable depuis Cloudflare, sans dates ni heures.
 * Le calendrier de la saison (dates, heures) est donc exporté une fois depuis un ordinateur
 * (`npm run calendrier`) et embarqué dans le site ; classements et membres sont lus sur data.aftt.be
 * si l'API ne répond pas. Aucun identifiant n'est nécessaire.
 */
const SITE = 'https://data.aftt.be';
const ENDPOINT = 'https://api.aftt.be/';
const NS = 'http://api.frenoy.net/TabTAPI';

async function call(operation, fields) {
  const body = Object.entries(fields).map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`).join('');
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>
<${operation}Request xmlns="${NS}">${body}</${operation}Request>
</soapenv:Body></soapenv:Envelope>`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${operation}"` },
    body: envelope,
    signal: AbortSignal.timeout(20000),
  });
  const raw = await res.text();
  const xml = raw.replace(/<(\/?)[\w-]+:/g, '<$1');   // retire les préfixes de namespace
  const fault = field(xml, 'faultstring');
  if (!res.ok || fault) {
    const err = new Error(`Fédération : ${fault || 'HTTP ' + res.status}`);
    err.detail = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400);
    throw err;
  }
  return xml;
}

function escapeXml(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim(); }
function blocks(xml, tag) { return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]); }
function field(xml, tag) { const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? decode(m[1]) : ''; }

/** "GEUTEN" + "DENIS" -> "Denis Geuten" */
function prettyName(first, last) {
  const cap = (s) => s.toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, (m, sep, c) => sep + c.toUpperCase());
  return `${cap(first)} ${cap(last)}`.trim();
}

export const aftt = {
  /** Équipes du club et leur division */
  async equipes(club) {
    const xml = await call('GetClubTeams', { Club: club });
    return blocks(xml, 'TeamEntries').map((b) => ({
      lettre: field(b, 'Team'),
      divisionId: field(b, 'DivisionId'),
      division: field(b, 'DivisionName'),
      divisionCourte: (field(b, 'DivisionName').match(/Division\s+(\S+)/) || [])[1] || field(b, 'DivisionName'),
    }));
  },

  /** Rencontres du club pour une semaine (1..22) : calendrier embarqué, sinon API */
  async rencontres(club, semaine, { soapOnly = false, calendrier = null } = {}) {
    if (!soapOnly && calendrier?.club === club) {
      const s = (calendrier.semaines || []).find((x) => x.semaine === Number(semaine));
      if (s) return s.rencontres;
    }
    const xml = await call('GetMatches', { Club: club, WeekName: String(semaine).padStart(2, '0'), ShowDivisionName: 'short' });
    return blocks(xml, 'TeamMatchesEntries').map((b) => {
      const home = field(b, 'HomeClub') === club;
      const ours = home ? field(b, 'HomeTeam') : field(b, 'AwayTeam');
      const other = home ? field(b, 'AwayTeam') : field(b, 'HomeTeam');
      return {
        matchId: field(b, 'MatchId'),
        semaine: parseInt(field(b, 'WeekName'), 10),
        lettre: (ours.match(/\s([A-Z])$/) || [])[1] || '',
        adversaire: other.replace(/\s*\(fg\)\s*$/i, ''),
        lieu: home ? 'domicile' : 'exterieur',
        date: field(b, 'Date'),
        heure: field(b, 'Time').slice(0, 5),
        division: field(b, 'DivisionName'),
        score: field(b, 'Score'),
        forfaitDom: field(b, 'IsHomeForfeited') === 'true',
        forfaitExt: field(b, 'IsAwayForfeited') === 'true',
      };
    });
  },

  /** Membres du club avec leur classement : API, sinon page data.aftt.be */
  async membres(club) {
    try {
      const xml = await call('GetMembers', { Club: club });
      return blocks(xml, 'MemberEntries').map((b) => ({
        nom: prettyName(field(b, 'FirstName'), field(b, 'LastName')),
        classement: field(b, 'Ranking'),
        licence: field(b, 'UniqueIndex'),
        position: parseInt(field(b, 'Position'), 10) || 0,
      }));
    } catch (e) {
      console.warn('API membres indisponible, lecture du site :', e.message);
      return scrapeMembres(club);
    }
  },

  /** Équipes + classements de leurs divisions : API, sinon page data.aftt.be */
  async club(club, nomClub) {
    try {
      const equipes = await this.equipes(club);
      const classements = await Promise.all(equipes.map(async (e) => ({ ...e, rows: await this.classement(e.divisionId) })));
      return { equipes, classements };
    } catch (e) {
      console.warn('API équipes/classements indisponible, lecture du site :', e.message);
      return scrapeClub(club, nomClub);
    }
  },

  /** Classement d'une division */
  async classement(divisionId) {
    const xml = await call('GetDivisionRanking', { DivisionId: divisionId });
    return blocks(xml, 'RankingEntries').map((b) => ({
      pos: parseInt(field(b, 'Position'), 10) || 0,
      equipe: field(b, 'Team'),
      club: field(b, 'TeamClub'),
      joues: parseInt(field(b, 'GamesPlayed'), 10) || 0,
      gagnes: parseInt(field(b, 'GamesWon'), 10) || 0,
      perdus: parseInt(field(b, 'GamesLost'), 10) || 0,
      nuls: parseInt(field(b, 'GamesDraw'), 10) || 0,
      points: parseInt(field(b, 'Points'), 10) || 0,
    }));
  },
};

/* ---------- Lecture des pages data.aftt.be (secours) ---------- */

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; ttstpierre-dashboard)' };
const text = (html) => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

async function scrapeMembres(club) {
  const res = await fetch(`${SITE}/ranking/clubs.php?indice=${encodeURIComponent(club)}`, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`data.aftt.be : HTTP ${res.status}`);
  const html = await res.text();
  const seen = new Set();
  const out = [];
  for (const row of html.matchAll(/<tr[^>]*data-listing-row[^>]*>([\s\S]*?)<\/tr>/g)) {
    const r = row[1];
    const licence = (r.match(/licenceID=(\d+)/) || [])[1];
    const nom = text((r.match(/class="listing-player"[^>]*>([\s\S]*?)<\/a>/) || [, ''])[1]);
    const classement = text((r.match(/class="listing-rank">([\s\S]*?)<\/span>/) || [, ''])[1]);
    if (!licence || !nom || seen.has(licence)) continue;
    seen.add(licence);
    out.push({ nom, classement, licence, position: out.length + 1 });
  }
  if (!out.length) throw new Error('data.aftt.be : aucun membre lu');
  return out;
}

async function scrapeClub(club, nomClub) {
  const res = await fetch(`${SITE}/interclubs/rankings.php`, {
    method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `indice=${encodeURIComponent(club)}`, signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`data.aftt.be : HTTP ${res.status}`);
  const html = await res.text();
  const cards = html.split(/class="card-header[^"]*"/).slice(1);
  const equipes = [];
  const classements = [];
  for (const card of cards) {
    const division = text(card.slice(0, 400)).match(/Division\s+\S+[^<]*?(?=\s*#|\s*$)/);
    const nomDivision = division ? division[0].trim() : '';
    if (!nomDivision) continue;
    const rows = [];
    const tbody = (card.match(/<tbody>([\s\S]*?)<\/tbody>/) || [, ''])[1];
    for (const tr of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
      if (cells.length < 8) continue;
      const equipe = cells[1].replace(/\s*\(fg\)\s*$/i, '');
      rows.push({
        pos: parseInt(cells[0], 10) || 0, equipe,
        club: nomClub && equipe.startsWith(nomClub) ? club : '',
        joues: +cells[2] || 0, gagnes: +cells[3] || 0, perdus: +cells[4] || 0, nuls: +cells[5] || 0, points: +cells[7] || 0,
      });
    }
    if (!rows.length) continue;
    const ours = rows.find((r) => r.club === club);
    const lettre = ours ? (ours.equipe.match(/\s([A-Z])$/) || [])[1] || '' : '';
    const divisionCourte = (nomDivision.match(/Division\s+(\S+)/) || [])[1] || nomDivision;
    const e = { lettre, divisionId: '', division: nomDivision, divisionCourte };
    if (lettre) equipes.push(e);
    classements.push({ ...e, rows });
  }
  if (!equipes.length) throw new Error('data.aftt.be : aucune équipe lue');
  return { equipes, classements };
}
