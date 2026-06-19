# mcp_web_search

MCP-сервер для веб-поиска, получения контента и скрапинга страниц. Работает через [Model Context Protocol](https://modelcontextprotocol.io/) — подключается к Claude Desktop и другим MCP-совместимым клиентам.

## Возможности

| Инструмент | Описание |
|---|---|
| `web_search` | Поиск через DuckDuckGo HTML (без API-ключа). Возвращает заголовки, URL и сниппеты |
| `web_fetch` | Загрузка страницы и извлечение текстового содержимого. Опционально — список ссылок |
| `web_scrape` | Скрапинг через Playwright для динамических/JS-сайтов. Поддержка скриншотов |
| `open_url` | Открытие страницы в headless-браузере: заголовок, HTTP-статус, превью контента |

### Защита от блокировок

- Случайные User-Agent, Accept-Language, Sec-Ch-Ua и другие заголовки
- Случайные задержки между запросами
- Разные профили браузера при каждом запуске Playwright

## Установка

```bash
git clone <repo-url> mcp_web_search
cd mcp_web_search
npm install
npm run build
```

Для Playwright необходимо установить Chromium:

```bash
npx playwright install chromium
```

## Использование

### Ручной запуск

```bash
npm run build   # Сборка TypeScript → dist/
npm start       # Запуск через stdio
```

### dev-режим (без сборки)

```bash
npm run dev
```

### Подключение к Claude Desktop

Добавь в `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp_web_search": {
      "command": "node",
      "args": ["/путь/к/mcp_web_search/dist/index.js"]
    }
  }
}
```

## Инструменты

### `web_search`

Поиск через DuckDuckGo HTML. Не требует API-ключа.

```json
{ "query": "TypeScript MCP server", "maxResults": 10 }
```

### `web_fetch`

Загрузка страницы и извлечение текста. Быстрее, чем `web_scrape`, но без поддержки JavaScript.

```json
{ "url": "https://example.com", "withLinks": true, "maxContentLength": 5000 }
```

### `web_scrape`

Полноценный браузерный скрапинг через Playwright Chromium. Для сайтов, которые рендерят контент на клиенте (React, Vue и т.д.).

```json
{
  "url": "https://example.com",
  "waitForSelector": ".article-body",
  "timeout": 30000,
  "maxContentLength": 15000,
  "takeScreenshot": false
}
```

### `open_url`

Лёгкое открытие страницы — возвращает заголовок, HTTP-статус и краткое превью.

```json
{ "url": "https://example.com", "timeout": 15000 }
```

## Стек

- [TypeScript](https://www.typescriptlang.org/) (ES2022, ESM)
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — MCP-сервер
- [Playwright](https://playwright.dev/) — headless-браузер для динамических страниц
- [Cheerio](https://cheerio.js.org/) — парсинг HTML
- [Zod](https://zod.dev/) — валидация параметров

## Скрипты

| Команда | Описание |
|---|---|
| `npm run build` | Компиляция TypeScript |
| `npm start` | Запуск скомпилированного сервера |
| `npm run dev` | Запуск через tsx (без компиляции) |

## Лицензия

ISC
