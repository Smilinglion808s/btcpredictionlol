import {createReceiver} from '../v12-shared/receiver.ts';
Deno.serve(createReceiver('U',key=>Deno.env.get(key)));
