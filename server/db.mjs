import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { diaAtual, listarDiasRecentes } from "./dias.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const caminhoDb = join(__dirname, "data", "counters.db");

mkdirSync(dirname(caminhoDb), { recursive: true });

const db = new Database(caminhoDb);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS dias (
    dia TEXT PRIMARY KEY,
    obediencia INTEGER NOT NULL DEFAULT 0,
    desobediencia INTEGER NOT NULL DEFAULT 0,
    atualizado_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL CHECK (tipo IN ('obediencia', 'desobediencia')),
    delta INTEGER NOT NULL CHECK (delta IN (-1, 1)),
    criado_em TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_eventos_criado ON eventos(criado_em);
`);

const stmtGarantirDia = db.prepare(`
  INSERT INTO dias (dia, obediencia, desobediencia, atualizado_em)
  VALUES (@dia, 0, 0, @agora)
  ON CONFLICT(dia) DO NOTHING
`);

const stmtLerDia = db.prepare(`
  SELECT dia, obediencia, desobediencia, atualizado_em AS atualizadoEm
  FROM dias
  WHERE dia = ?
`);

const stmtAtualizar = db.prepare(`
  UPDATE dias
  SET
    obediencia = @obediencia,
    desobediencia = @desobediencia,
    atualizado_em = @agora
  WHERE dia = @dia
`);

const stmtInserirEvento = db.prepare(`
  INSERT INTO eventos (tipo, delta, criado_em)
  VALUES (@tipo, @delta, @agora)
`);

const stmtHistorico = db.prepare(`
  SELECT dia, obediencia, desobediencia, atualizado_em AS atualizadoEm
  FROM dias
  WHERE dia >= ? AND dia <= ?
`);

function agoraIso() {
  return new Date().toISOString();
}

function garantirDia(dia) {
  stmtGarantirDia.run({ dia, agora: agoraIso() });
  return stmtLerDia.get(dia);
}

export function obterHoje() {
  const dia = diaAtual();
  return garantirDia(dia);
}

export function registrarEvento(tipo, delta) {
  if (tipo !== "obediencia" && tipo !== "desobediencia") {
    const erro = new Error("Tipo inválido");
    erro.status = 400;
    throw erro;
  }
  if (delta !== 1 && delta !== -1) {
    const erro = new Error("Delta inválido");
    erro.status = 400;
    throw erro;
  }

  const dia = diaAtual();
  const agora = agoraIso();

  const transacao = db.transaction(() => {
    const atual = garantirDia(dia);
    const proximo = {
      dia,
      obediencia: atual.obediencia,
      desobediencia: atual.desobediencia,
      atualizadoEm: agora,
    };

    if (tipo === "obediencia") {
      proximo.obediencia = Math.max(0, atual.obediencia + delta);
    } else {
      proximo.desobediencia = Math.max(0, atual.desobediencia + delta);
    }

    // Só grava evento se o valor mudou (ex.: −1 em zero não gera evento)
    if (
      proximo.obediencia === atual.obediencia &&
      proximo.desobediencia === atual.desobediencia
    ) {
      return atual;
    }

    stmtAtualizar.run({
      dia,
      obediencia: proximo.obediencia,
      desobediencia: proximo.desobediencia,
      agora,
    });
    stmtInserirEvento.run({ tipo, delta, agora });
    return proximo;
  });

  return transacao();
}

export function obterHistorico(quantidadeDias = 30) {
  const dias = listarDiasRecentes(quantidadeDias);
  const inicio = dias[0];
  const fim = dias[dias.length - 1];
  const mapa = new Map(
    stmtHistorico.all(inicio, fim).map((linha) => [linha.dia, linha])
  );

  return dias.map((dia) => {
    const existente = mapa.get(dia);
    if (existente) return existente;
    return {
      dia,
      obediencia: 0,
      desobediencia: 0,
      atualizadoEm: null,
    };
  });
}

export function fecharDb() {
  db.close();
}
