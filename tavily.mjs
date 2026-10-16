// Tavily search layer (Axios, no SDK needed).
import axios from 'axios';
import { config } from './config.mjs';

export async function tavilySearch(query) {
  if (!config.tavilyApiKey) {
    throw new Error('Missing TAVILY_API_KEY — copy .env.example to .env and add your key.');
  }
  const { data } = await axios.post(
    'https://api.tavily.com/search',
    {
      query,
      search_depth: config.searchDepth, // 'basic' costs 1 credit
      max_results: config.maxResults,
      include_answer: false,
      include_raw_content: false,
    },
    {
      headers: { Authorization: `Bearer ${config.tavilyApiKey}` },
      timeout: 30000,
    }
  );
  // data = { query, results: [{ title, url, content, published_date, score }], ... }
  return data;
}
