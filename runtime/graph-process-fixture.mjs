import {readFile} from 'node:fs/promises';
import {startRuntime} from './server.mjs';
import {graphProviderFixture} from './graph-test-support.mjs';
const provider=graphProviderFixture(),instance=await startRuntime(JSON.parse(await readFile(process.env.EMAIL_RUNTIME_CONFIG_FILE,'utf8')),{allow_windows_fixture:process.platform==='win32',allow_loopback_fixture:true,start_send_workers:false,start_observation_workers:false,fetch:async(...args)=>{const result=await provider(...args);if(new URL(args[0]).pathname==='/v1.0/me/mailFolders/archive/messages')process.send?.({event:'archive_endpoint',path:new URL(args[0]).pathname});process.send?.({event:'provider_counts',counts:provider.counts});return result;}});
process.send?.({port:instance.server.address().port});
process.on('message',async message=>{if(message==='shutdown'){await instance.close();process.exit(0);}});
