/**
 * Client minimal de l'API TabT de la fédération (api.aftt.be, SOAP document/literal).
 * Aucun identifiant n'est nécessaire pour les appels utilisés ici.
 */
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
  const xml = (await res.text()).replace(/<(\/?)[\w-]+:/g, '<$1');   // retire les préfixes de namespace
  const fault = field(xml, 'faultstring');
  if (!res.ok || fault) throw new Error(`Fédération : ${fault || 'HTTP ' + res.status}`);
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

  /** Rencontres du club pour une semaine (01..22) */
  async rencontres(club, semaine) {
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

  /** Membres du club avec leur classement */
  async membres(club) {
    const xml = await call('GetMembers', { Club: club });
    return blocks(xml, 'MemberEntries').map((b) => ({
      nom: prettyName(field(b, 'FirstName'), field(b, 'LastName')),
      classement: field(b, 'Ranking'),
      licence: field(b, 'UniqueIndex'),
      position: parseInt(field(b, 'Position'), 10) || 0,
    }));
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
