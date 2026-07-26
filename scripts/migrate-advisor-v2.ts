import { randomUUID } from 'node:crypto'
import type mysql from 'mysql2/promise'

type MigrationConnection=Pick<mysql.Connection,'query'|'execute'>

function duplicateSchemaObject(error:unknown){
  return error instanceof Error&&'code' in error&&['ER_DUP_FIELDNAME','ER_DUP_KEYNAME','ER_FK_DUP_NAME'].includes(String(error.code))
}

export async function migrateAdvisorV2(connection:MigrationConnection,databaseName:string){
  const database=`\`${databaseName}\``
  const alterations=[
    `ALTER TABLE ${database}.advisor_conversations ADD COLUMN memory_summary TEXT NULL AFTER title`,
    `ALTER TABLE ${database}.advisor_conversations ADD COLUMN summarized_through_message_id BIGINT UNSIGNED NULL AFTER memory_summary`,
    `ALTER TABLE ${database}.advisor_conversations ADD COLUMN legacy_key VARCHAR(64) NULL AFTER summarized_through_message_id`,
    `ALTER TABLE ${database}.advisor_conversation_messages ADD COLUMN client_message_id CHAR(36) NULL AFTER content`,
    `ALTER TABLE ${database}.advisor_conversation_messages ADD COLUMN reply_to_message_id BIGINT UNSIGNED NULL AFTER client_message_id`,
    `ALTER TABLE ${database}.advisor_conversation_messages ADD COLUMN generation_status ENUM('pending','complete','failed') NULL AFTER reply_to_message_id`,
    `ALTER TABLE ${database}.advisor_conversation_messages ADD COLUMN legacy_message_id BIGINT UNSIGNED NULL AFTER generation_status`,
    `CREATE UNIQUE INDEX uk_advisor_conversation_legacy ON ${database}.advisor_conversations(profile_id,legacy_key)`,
    `CREATE UNIQUE INDEX uk_advisor_client_message ON ${database}.advisor_conversation_messages(conversation_id,client_message_id)`,
    `CREATE UNIQUE INDEX uk_advisor_legacy_message ON ${database}.advisor_conversation_messages(legacy_message_id)`,
  ]
  for(const statement of alterations){try{await connection.query(statement)}catch(error){if(!duplicateSchemaObject(error))throw error}}

  const [profiles]=await connection.query<mysql.RowDataPacket[]>(`SELECT DISTINCT profile_id profileId FROM ${database}.advisor_messages ORDER BY profile_id`)
  for(const profile of profiles){
    const profileId=String(profile.profileId)
    const [existing]=await connection.execute<mysql.RowDataPacket[]>(`SELECT id FROM ${database}.advisor_conversations WHERE profile_id=? AND legacy_key='legacy-v1' LIMIT 1`,[profileId])
    const conversationId=existing[0]?.id?String(existing[0].id):randomUUID()
    if(!existing[0])await connection.execute(`INSERT INTO ${database}.advisor_conversations(id,profile_id,focus_type,focus_id,focus_name,title,legacy_key,created_at,updated_at) SELECT ?,?,'general',NULL,NULL,'以前的讨论','legacy-v1',MIN(created_at),MAX(created_at) FROM ${database}.advisor_messages WHERE profile_id=?`,[conversationId,profileId,profileId])
    await connection.execute(`INSERT IGNORE INTO ${database}.advisor_conversation_messages(conversation_id,role,content,generation_status,legacy_message_id,created_at) SELECT ?,role,content,'complete',id,created_at FROM ${database}.advisor_messages WHERE profile_id=? ORDER BY id`,[conversationId,profileId])
  }
}
