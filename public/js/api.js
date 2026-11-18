async function requisitar(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(opcoes.body ? { "Content-Type": "application/json" } : {}),
      ...opcoes.headers,
    },
    ...opcoes,
  });

  let dados = null;
  try {
    dados = await resposta.json();
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    const erro = new Error(dados?.erro || `Falha HTTP ${resposta.status}`);
    erro.status = resposta.status;
    throw erro;
  }

  return dados;
}

export function buscarHoje(signal) {
  return requisitar("/api/hoje", { signal });
}

export function buscarDia(dia, signal) {
  return requisitar(`/api/dia/${encodeURIComponent(dia)}`, { signal });
}

export function buscarHistorico(dias, signal) {
  return requisitar(`/api/historico?dias=${encodeURIComponent(dias)}`, {
    signal,
  });
}

export function enviarEvento({ tipo, delta, comentario, dia }) {
  return requisitar("/api/evento", {
    method: "POST",
    body: JSON.stringify({ tipo, delta, comentario, dia }),
  });
}

export function definirDia(dia, obediencia, desobediencia, desculpa) {
  return requisitar(`/api/dia/${encodeURIComponent(dia)}`, {
    method: "PUT",
    body: JSON.stringify({ obediencia, desobediencia, desculpa }),
  });
}

export function salvarComentario(eventoId, comentario) {
  return requisitar(`/api/evento/${encodeURIComponent(eventoId)}`, {
    method: "PATCH",
    body: JSON.stringify({ comentario }),
  });
}

export function excluirEvento(eventoId) {
  return requisitar(`/api/evento/${encodeURIComponent(eventoId)}`, {
    method: "DELETE",
  });
}

export function restaurarEvento(eventoId) {
  return requisitar(`/api/evento/${encodeURIComponent(eventoId)}`, {
    method: "PATCH",
    body: JSON.stringify({ restaurar: true }),
  });
}
