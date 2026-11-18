import { createServer } from "node:http";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  obterHoje,
  obterDia,
  registrarEvento,
  obterHistorico,
  definirContagens,
  atualizarComentario,
  excluirEvento,
  restaurarEvento,
} from "./db.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PASTA_PUBLICA = join(__dirname, "..", "public");
const PORTA = Number(process.env.PORTA || process.env.OBEDIENCIA_PORT || 8791);
const HOST = process.env.OBEDIENCIA_HOST || "127.0.0.1";
const LIMITE_POR_MINUTO = Number(process.env.RATE_LIMIT_POR_MINUTO || 90);

const TIPOS_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const janelas = new Map();

function ipDoCliente(req) {
  const encaminhado = req.headers["x-forwarded-for"];
  if (typeof encaminhado === "string" && encaminhado.length > 0) {
    return encaminhado.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "desconhecido";
}

function dentroDoLimite(ip) {
  const agora = Date.now();
  let janela = janelas.get(ip);
  if (!janela || agora - janela.inicio >= 60_000) {
    janela = { inicio: agora, contagem: 0 };
    janelas.set(ip, janela);
  }
  janela.contagem += 1;
  return janela.contagem <= LIMITE_POR_MINUTO;
}

setInterval(() => {
  const agora = Date.now();
  for (const [ip, janela] of janelas) {
    if (agora - janela.inicio >= 120_000) janelas.delete(ip);
  }
}, 60_000).unref();

function enviarJson(res, status, corpo) {
  const payload = JSON.stringify(corpo);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function lerCorpo(req, limite = 8192) {
  return new Promise((resolve, reject) => {
    const pedacos = [];
    let tamanho = 0;
    req.on("data", (chunk) => {
      tamanho += chunk.length;
      if (tamanho > limite) {
        reject(Object.assign(new Error("Corpo grande demais"), { status: 413 }));
        req.destroy();
        return;
      }
      pedacos.push(chunk);
    });
    req.on("end", () => {
      const bruto = Buffer.concat(pedacos).toString("utf8");
      if (!bruto) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(bruto));
      } catch {
        reject(Object.assign(new Error("JSON inválido"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function servirEstatico(req, res, urlPath) {
  let relativo = decodeURIComponent(urlPath.split("?")[0]);
  if (relativo === "/" || relativo === "") relativo = "/index.html";

  const caminho = normalize(join(PASTA_PUBLICA, relativo));
  if (!caminho.startsWith(PASTA_PUBLICA)) {
    enviarJson(res, 403, { erro: "Acesso negado" });
    return;
  }

  if (!existsSync(caminho) || !statSync(caminho).isFile()) {
    enviarJson(res, 404, { erro: "Não encontrado" });
    return;
  }

  const ext = extname(caminho).toLowerCase();
  const tipo = TIPOS_MIME[ext] || "application/octet-stream";
  const estaticoLongo = ext !== ".html";

  res.writeHead(200, {
    "Content-Type": tipo,
    "Cache-Control": estaticoLongo ? "public, max-age=604800" : "no-cache",
  });
  createReadStream(caminho).pipe(res);
}

async function tratarApi(req, res, pathname) {
  if (pathname === "/api/hoje" && req.method === "GET") {
    return enviarJson(res, 200, obterHoje());
  }

  if (pathname === "/api/historico" && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const dias = Number(url.searchParams.get("dias") || 30);
    return enviarJson(res, 200, {
      dias: obterHistorico(dias),
    });
  }

  const matchDia = pathname.match(/^\/api\/dia\/(\d{4}-\d{2}-\d{2})$/);
  if (matchDia && req.method === "GET") {
    return enviarJson(res, 200, obterDia(matchDia[1]));
  }

  if (matchDia && req.method === "PUT") {
    const corpo = await lerCorpo(req);
    return enviarJson(
      res,
      200,
      definirContagens(
        matchDia[1],
        corpo.obediencia,
        corpo.desobediencia,
        corpo.desculpa
      )
    );
  }

  if (pathname === "/api/evento" && req.method === "POST") {
    const corpo = await lerCorpo(req);
    const resultado = registrarEvento(corpo.tipo, Number(corpo.delta), {
      comentario: corpo.comentario,
      dia: corpo.dia,
    });
    return enviarJson(res, 200, resultado);
  }

  const matchEvento = pathname.match(/^\/api\/evento\/(\d+)$/);
  if (matchEvento && req.method === "PATCH") {
    const corpo = await lerCorpo(req);
    if (corpo.restaurar === true) {
      return enviarJson(res, 200, restaurarEvento(matchEvento[1]));
    }
    return enviarJson(
      res,
      200,
      atualizarComentario(matchEvento[1], corpo.comentario)
    );
  }

  if (matchEvento && req.method === "DELETE") {
    return enviarJson(res, 200, excluirEvento(matchEvento[1]));
  }

  if (pathname === "/api/saude" && req.method === "GET") {
    return enviarJson(res, 200, { ok: true });
  }

  enviarJson(res, 404, { erro: "Rota não encontrada" });
}

const servidor = createServer(async (req, res) => {
  try {
    const ip = ipDoCliente(req);
    if (!dentroDoLimite(ip)) {
      enviarJson(res, 429, {
        erro: "Muitas requisições. Tente de novo em instantes.",
      });
      return;
    }

    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      await tratarApi(req, res, pathname);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      enviarJson(res, 405, { erro: "Método não permitido" });
      return;
    }

    servirEstatico(req, res, pathname);
  } catch (erro) {
    const status = erro.status || 500;
    enviarJson(res, status, {
      erro: status >= 500 ? "Erro interno" : erro.message || "Erro",
    });
  }
});

servidor.listen(PORTA, HOST, () => {
  console.log(`Obediência API em http://${HOST}:${PORTA}`);
});
