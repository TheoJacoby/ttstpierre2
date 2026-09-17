/**
 * Stockage des scores de la journée en cours : un Durable Object (SQLite), fortement cohérent.
 * Contrairement au KV, une écriture est visible immédiatement par toutes les lectures suivantes.
 */
import { DurableObject } from 'cloudflare:workers';

export class Scores extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }

  /** { clé: valeur JSON } pour les clés trouvées */
  getMany(keys) {
    const out = {};
    for (const k of keys) {
      const row = this.sql.exec('SELECT v FROM kv WHERE k = ?', k).toArray()[0];
      if (row) out[k] = JSON.parse(row.v);
    }
    return out;
  }

  put(key, value) { this.sql.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', key, JSON.stringify(value)); }

  del(keys) { for (const k of keys) this.sql.exec('DELETE FROM kv WHERE k = ?', k); }

  delPrefix(prefix) { this.sql.exec("DELETE FROM kv WHERE k LIKE ? ESCAPE '\\'", prefix.replace(/[%_\\]/g, '\\$&') + '%'); }
}
