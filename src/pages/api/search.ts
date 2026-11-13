import type { APIRoute } from 'astro';
import { getStore } from '../../lib/store';
import { json } from '../../lib/http';

export const GET: APIRoute = async ({ url }) => json({ results: await getStore().search(url.searchParams.get('q') ?? '') });
