import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diaAtual, listarDiasRecentes } from "./dias.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pastaDados = join(__dirname, "data");
const caminhoDb = join(pastaDados, "counters.json");

mkdirSync(pastaDados, { recursive: true });

function estadoVazio() {
  return { dias: {}, eventos: [] };
}

function carregar() {
  if (!existsSync(caminhoDb)) return estadoVazio();
  try {
    const dados = JSON.parse(readFileSync(caminhoDb, "utf8"));
    if (!dados || typeof dados !== "object") return estadoVazio();
    if (!dados.dias || typeof dados.dias !== "object") dados.dias = {};
    if (!Array.isArray(dados.eventos)) dados.eventos = [];
    return dados;
  } catch {
    return estadoVazio();
  }
}

function salvar(estado) {
  const tmp = `${caminhoDb}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(estado)}\n`, "utf8");
  renameSync(tmp, caminhoDb);
}

function agoraIso() {
  return new Date().toISOString();
}

function garantirDia(estado, dia) {
  if (!estado.dias[dia]) {
    estado.dias[dia] = {
      dia,
      obediencia: 0,
      desobediencia: 0,
      atualizadoEm: agoraIso(),
    };
    return { registro: estado.dias[dia], criado: true };
  }
  return { registro: estado.dias[dia], criado: false };
}

export function obterHoje() {
  const estado = carregar();
  const dia = diaAtual();
  const { registro, criado } = garantirDia(estado, dia);
  if (criado) salvar(estado);
  return { ...registro };
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

  const estado = carregar();
  const dia = diaAtual();
  const { registro: atual } = garantirDia(estado, dia);
  const agora = agoraIso();

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

  if (
    proximo.obediencia === atual.obediencia &&
    proximo.desobediencia === atual.desobediencia
  ) {
    return { ...atual };
  }

  estado.dias[dia] = proximo;
  estado.eventos.push({
    id: estado.eventos.length + 1,
    tipo,
    delta,
    criadoEm: agora,
  });
  if (estado.eventos.length > 5000) {
    estado.eventos = estado.eventos.slice(-4000);
  }
  salvar(estado);
  return { ...proximo };
}

export function obterHistorico(quantidadeDias = 30) {
  const estado = carregar();
  return listarDiasRecentes(quantidadeDias).map((dia) => {
    const existente = estado.dias[dia];
    if (existente) return { ...existente };
    return {
      dia,
      obediencia: 0,
      desobediencia: 0,
      atualizadoEm: null,
    };
  });
}

export function fecharDb() {}
