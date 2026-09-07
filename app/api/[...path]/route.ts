import {env} from 'cloudflare:workers';
import {api} from '@/lib/service';
export const dynamic='force-dynamic';
export function GET(req:Request){return api(req,env as any)}
export function POST(req:Request){return api(req,env as any)}
