const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

function carregarEnv(caminho) {
  if (!existsSync(caminho)) return {};
  const env = {};
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const texto = linha.trim();
    if (!texto || texto.startsWith("#")) continue;
    const eq = texto.indexOf("=");
    if (eq <= 0) continue;
    const chave = texto.slice(0, eq).trim();
    let valor = texto.slice(eq + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    env[chave] = valor;
  }
  return env;
}

const secrets = carregarEnv(join(__dirname, ".env"));

module.exports = {
  apps: [
    {
      name: "obediencia-api",
      script: "server/index.mjs",
      cwd: "/var/www/obediencia",
      env: {
        NODE_ENV: "production",
        OBEDIENCIA_PORT: Number(secrets.OBEDIENCIA_PORT || 8791),
        OBEDIENCIA_HOST: secrets.OBEDIENCIA_HOST || "127.0.0.1",
        RATE_LIMIT_POR_MINUTO: Number(secrets.RATE_LIMIT_POR_MINUTO || 60),
      },
      autorestart: true,
      max_memory_restart: "128M",
    },
  ],
};
