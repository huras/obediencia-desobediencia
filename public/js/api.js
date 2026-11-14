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

export function buscarHistorico(dias, signal) {
  return requisitar(`/api/historico?dias=${encodeURIComponent(dias)}`, {
    signal,
  });
}

export function enviarEvento(tipo, delta) {
  return requisitar("/api/evento", {
    method: "POST",
    body: JSON.stringify({ tipo, delta }),
  });
}
