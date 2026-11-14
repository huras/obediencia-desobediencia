let grafico = null;

function rotuloCurto(diaIso) {
  const [, mes, dia] = diaIso.split("-");
  return `${Number(dia)}/${Number(mes)}`;
}

function aguardarChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  return new Promise((resolve, reject) => {
    let tentativas = 0;
    const id = setInterval(() => {
      tentativas += 1;
      if (window.Chart) {
        clearInterval(id);
        resolve(window.Chart);
      } else if (tentativas > 80) {
        clearInterval(id);
        reject(new Error("Chart.js não carregou"));
      }
    }, 50);
  });
}

export async function inicializarGrafico(canvas) {
  const Chart = await aguardarChartJs();
  const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  grafico = new Chart(canvas, {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Obediência",
          data: [],
          backgroundColor: "rgba(61, 186, 138, 0.85)",
          borderRadius: 6,
          maxBarThickness: 18,
        },
        {
          label: "Desobediência",
          data: [],
          backgroundColor: "rgba(224, 122, 74, 0.85)",
          borderRadius: 6,
          maxBarThickness: 18,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduzido ? false : { duration: 450 },
      plugins: {
        legend: {
          labels: {
            color: "#a8c4c0",
            boxWidth: 12,
            font: { family: '"Source Sans 3", sans-serif', weight: "600" },
          },
        },
        tooltip: {
          callbacks: {
            title(itens) {
              return itens[0]?.label || "";
            },
          },
        },
      },
      scales: {
        x: {
          stacked: false,
          ticks: { color: "#a8c4c0", maxRotation: 0, autoSkipPadding: 8 },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#a8c4c0",
            precision: 0,
          },
          grid: { color: "rgba(255,255,255,0.08)" },
        },
      },
    },
  });

  return grafico;
}

export function atualizarGrafico(serie) {
  if (!grafico) return;

  grafico.data.labels = serie.map((item) => rotuloCurto(item.dia));
  grafico.data.datasets[0].data = serie.map((item) => item.obediencia);
  grafico.data.datasets[1].data = serie.map((item) => item.desobediencia);
  grafico.update();
}

export function calcularResumo(serie) {
  let obediencia = 0;
  let desobediencia = 0;
  for (const item of serie) {
    obediencia += item.obediencia;
    desobediencia += item.desobediencia;
  }
  const total = obediencia + desobediencia;
  const razao = total === 0 ? null : Math.round((obediencia / total) * 100);
  return { obediencia, desobediencia, razao };
}
