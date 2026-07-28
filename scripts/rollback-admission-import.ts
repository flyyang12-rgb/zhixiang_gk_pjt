import 'dotenv/config'
import { database } from '../server/database.js'
import { rollbackAdmissionImport } from '../server/admission-import.js'

const batchId=process.argv[2]
if(!batchId)throw new Error('用法：npm run data:admissions:rollback -- <batch-id>')
async function run(){
  const connection=await database.getConnection()
  try{console.log(JSON.stringify(await rollbackAdmissionImport(connection,batchId!),null,2))}
  finally{connection.release()}
}
run().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1}).finally(()=>database.end())
