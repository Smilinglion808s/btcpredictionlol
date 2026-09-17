import {createReceiver} from '../v12-shared/receiver.ts';
Deno.serve(createReceiver('V1',key=>Deno.env.get(key)));
