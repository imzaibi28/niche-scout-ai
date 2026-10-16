// Seed engine: {program} x {country} x {local-language query template}.
// Coverage: South America + Eastern Europe only (2026-09-30: Asia/Africa/Western
// Europe packs removed per Jonas's geography rule). "Everything" broad packs:
// validated winners (dream dictionaries, horoscopes, calendars, baby names,
// labor calculators) + utility patterns (calculators, converters, trackers,
// generators) + govt programs, all in local languages.
// Grow coverage by adding packs — no code changes needed.

export const PACKS = [
  // ---------------- SOUTH AMERICA ----------------
  {
    category: 'winners', country: 'Brazil', language: 'Portuguese',
    topics: ['sonhos', 'significado dos sonhos', 'mapa astral', 'horóscopo', 'horóscopo de hoje', 'calendário 2026', 'feriados 2026', 'nomes de menino', 'nomes de menina', 'calculadora rescisão'],
    templates: ['{p}', '{p} 2026'],
  },
  {
    category: 'calculators', country: 'Brazil', language: 'Portuguese',
    topics: ['calculadora de juros', 'conversor de moeda', 'calculadora IMC', 'calculadora de parcelas'],
    templates: ['{p}', '{p} online'],
  },
  {
    category: 'govt-program', country: 'Brazil', language: 'Portuguese',
    topics: ['Bolsa Família', 'INSS'],
    templates: ['{p} como consultar 2026', '{p} requisitos'],
  },
  {
    category: 'trackers', country: 'Brazil', language: 'Portuguese',
    topics: ['rastreio correios', 'gerador de nomes'],
    templates: ['{p}', '{p} online'],
  },
  {
    category: 'winners', country: 'Argentina', language: 'Spanish',
    topics: ['significado de los sueños', 'horóscopo', 'horóscopo de hoy', 'calendario 2026', 'feriados 2026', 'nombres de bebé', 'calculadora aguinaldo', 'precio dólar hoy'],
    templates: ['{p}', '{p} 2026'],
  },
  {
    category: 'calculators', country: 'Argentina', language: 'Spanish',
    topics: ['calculadora de plazo fijo', 'conversor de moneda', 'calculadora de sueldo'],
    templates: ['{p}', '{p} online'],
  },
  {
    category: 'govt-program', country: 'Argentina', language: 'Spanish',
    topics: ['ANSES jubilación', 'certificado de antecedentes'],
    templates: ['{p} como consultar', '{p} requisitos 2026'],
  },
  {
    category: 'winners', country: 'Colombia', language: 'Spanish',
    topics: ['significado de los sueños', 'horóscopo de hoy', 'calendario 2026', 'festivos 2026', 'nombres de niña', 'calculadora liquidación'],
    templates: ['{p}', '{p} 2026'],
  },
  {
    category: 'calculators', country: 'Colombia', language: 'Spanish',
    topics: ['calculadora de cesantías', 'conversor de moneda'],
    templates: ['{p}', '{p} online'],
  },
  {
    category: 'govt-program', country: 'Colombia', language: 'Spanish',
    topics: ['Renta Ciudadana', 'SISBEN'],
    templates: ['{p} como consultar 2026', '{p} requisitos'],
  },
  {
    category: 'winners', country: 'Chile', language: 'Spanish',
    topics: ['significado de los sueños', 'horóscopo de hoy', 'calendario 2026', 'feriados 2026', 'nombres de bebé', 'calculadora finiquito'],
    templates: ['{p}', '{p} 2026'],
  },
  {
    category: 'govt-program', country: 'Chile', language: 'Spanish',
    topics: ['Registro Social de Hogares', 'subsidio habitacional'],
    templates: ['{p} como postular 2026', '{p} requisitos'],
  },
  {
    category: 'winners', country: 'Peru', language: 'Spanish',
    topics: ['significado de los sueños', 'horóscopo de hoy', 'calendario 2026', 'feriados 2026', 'nombres de niño', 'calculadora CTS'],
    templates: ['{p}', '{p} 2026'],
  },
  {
    category: 'govt-program', country: 'Peru', language: 'Spanish',
    topics: ['SIS', 'bono'],
    templates: ['{p} como consultar', '{p} 2026'],
  },
  // ---------------- EASTERN EUROPE ----------------
  {
    category: 'winners', country: 'Poland', language: 'Polish',
    topics: ['sennik', 'horoskop', 'horoskop dzienny', 'kalendarz 2026', 'dni wolne 2026', 'imiona', 'imieniny'],
    templates: ['{p}', '{p} 2026'],
  },
  {
    category: 'calculators', country: 'Poland', language: 'Polish',
    topics: ['kalkulator wynagrodzeń', 'kalkulator kredytu', 'kalkulator BMI', 'przelicznik walut'],
    templates: ['{p}', '{p} online'],
  },
  {
    category: 'govt-program', country: 'Poland', language: 'Polish',
    topics: ['800 plus', 'mObywatel'],
    templates: ['{p} jak złożyć wniosek', '{p} warunki 2026'],
  },
  {
    category: 'winners', country: 'Romania', language: 'Romanian',
    topics: ['horoscop zilnic', 'calendar 2026', 'zile libere 2026', 'nume de fete', 'verificare RCA', 'calculator salariu'],
    templates: ['{p}', '{p} 2026'],
  },
  {
    category: 'converters', country: 'Romania', language: 'Romanian',
    topics: ['convertor valutar', 'verificare ITP'],
    templates: ['{p}', '{p} online'],
  },
  {
    category: 'winners', country: 'Ukraine', language: 'Ukrainian',
    topics: ['сонник', 'гороскоп', 'календар 2026', 'вихідні 2026', 'імена для дівчаток', 'калькулятор зарплати'],
    templates: ['{p}', '{p} 2026'],
  },
  {
    category: 'converters', country: 'Ukraine', language: 'Ukrainian',
    topics: ['конвертер валют'],
    templates: ['{p}', '{p} онлайн'],
  },
  {
    category: 'winners', country: 'Czechia', language: 'Czech',
    topics: ['snář', 'horoskop', 'kalendář 2026', 'státní svátky 2026', 'jména pro holky', 'kalkulačka mzdy'],
    templates: ['{p}', '{p} 2026'],
  },
  {
    category: 'converters', country: 'Czechia', language: 'Czech',
    topics: ['převod měn'],
    templates: ['{p}', '{p} online'],
  },
  {
    category: 'winners', country: 'Hungary', language: 'Hungarian',
    topics: ['álmoskönyv', 'horoszkóp', 'naptár 2026', 'munkaszüneti napok 2026', 'lánynevek', 'bérkalkulátor'],
    templates: ['{p}', '{p} 2026'],
  },
  {
    category: 'converters', country: 'Hungary', language: 'Hungarian',
    topics: ['valuta átváltás'],
    templates: ['{p}', '{p} online'],
  },
];

export function buildQueries() {
  const out = [];
  for (const pack of PACKS) {
    for (const p of pack.topics) {
      for (const t of pack.templates) {
        out.push({
          category: pack.category,
          country: pack.country,
          language: pack.language,
          program: p,
          query: t.replaceAll('{p}', p),
        });
      }
    }
  }
  return out;
}
