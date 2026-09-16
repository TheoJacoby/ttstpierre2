#!/usr/bin/env node
/**
 * Récupère le calendrier complet de la saison depuis l'API de la fédération (SOAP)
 * et l'écrit dans data/calendrier.json. À lancer depuis un ordinateur (pas depuis Cloudflare,
 * dont les requêtes vers cette API sont refusées) : `npm run calendrier`, puis `npm run deploy`.
 */
import { writeFileSync } from 'node:fs';
import { aftt } from '../src/aftt.js';

const club = process.argv[2] || 'Lx108';
const semaines = [];
for (let s = 1; s <= 22; s++) {
  const r = await aftt.rencontres(club, s, { soapOnly: true });
  if (!r.length) { console.log(`semaine ${s} : aucune rencontre, arrêt`); break; }
  semaines.push({ semaine: s, rencontres: r });
  console.log(`semaine ${s} : ${r.length} rencontres (${r.map((x) => x.date).sort()[0]} → ${r.map((x) => x.date).sort().pop()})`);
}
const out = { club, genere: new Date().toISOString(), semaines };
writeFileSync(new URL('../data/calendrier.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`data/calendrier.json écrit : ${semaines.length} semaines`);
