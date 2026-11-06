import {createScheduleStore,PROVIDERS,refreshSchedule,safeCode,changeRollback} from '../runtime/schedule-store.js';
import {createDiscoverers} from './providers.js';

try {
  const store = createScheduleStore(process.env.BUS_SCHEDULE_BUCKET);
  const [command,provider] = process.argv.slice(2);
  if (command) {
    if (!['rollback','resume'].includes(command)) throw Error('SCHEDULE_COMMAND_INVALID');
    console.log(JSON.stringify({event:'bus_schedule_refresh', ...await changeRollback({provider,store,resume:command==='resume'})}));
  } else {
    const discoverers = createDiscoverers({token:process.env.ODPT_ACCESS_TOKEN});
    for (const provider of PROVIDERS) {
      let result;
      try { result = await refreshSchedule({provider,store,discover:discoverers[provider]}); }
      catch (error) { result = {provider,result:'failed',error:safeCode(error)}; }
      console.log(JSON.stringify({event:'bus_schedule_refresh',...result}));
      if (result.error) process.exitCode=1;
    }
  }
} catch (error) {
  console.log(JSON.stringify({event:'bus_schedule_refresh',error:safeCode(error)}));
  process.exitCode=1;
}
