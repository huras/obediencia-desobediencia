const FUSO = "America/Sao_Paulo";

const formatadorDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const formatadorExibicao = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Retorna YYYY-MM-DD no fuso America/Sao_Paulo. */
export function diaAtual(referencia = new Date()) {
  return formatadorDia.format(referencia);
}

/** Lista de dias YYYY-MM-DD do mais antigo ao mais recente (inclui hoje). */
export function listarDiasRecentes(quantidade, referencia = new Date()) {
  const qtd = Math.max(1, Math.min(366, Number(quantidade) || 30));
  const hoje = diaAtual(referencia);
  const [ano, mes, dia] = hoje.split("-").map(Number);
  // Meio-dia UTC-ish estável: construímos a partir do calendário BR
  const base = Date.UTC(ano, mes - 1, dia, 15, 0, 0);
  const lista = [];
  for (let i = qtd - 1; i >= 0; i -= 1) {
    const d = new Date(base - i * 24 * 60 * 60 * 1000);
    lista.push(formatadorDia.format(d));
  }
  return lista;
}

export function formatarDiaExibicao(diaIso) {
  const [ano, mes, dia] = diaIso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia, 15, 0, 0));
  return formatadorExibicao.format(data);
}

export { FUSO };
