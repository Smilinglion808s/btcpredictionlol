import {createReceiver} from '../v12-shared/receiver.ts';
Deno.serve(createReceiver('T45R2',key=>Deno.env.get(key)));
