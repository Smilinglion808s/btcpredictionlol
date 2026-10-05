// Deploy ONLY to the predictor backend alevdzyisibxcvwoyrqb.
import { createClient } from 'npm:@supabase/supabase-js@2.108.2';
import { createAdapterHandler } from './core.js';

const url=Deno.env.get('SUPABASE_URL') ?? '';
if (url!=='https://alevdzyisibxcvwoyrqb.supabase.co') throw new Error('WRONG_PREDICTOR_BACKEND');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const secret=Deno.env.get('C85_GATEWAY_SECRET') ?? '';
if (!key || !secret) throw new Error('ADAPTER_SECRETS_UNAVAILABLE');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createAdapterHandler({secret:()=>secret,client:()=>client}));
