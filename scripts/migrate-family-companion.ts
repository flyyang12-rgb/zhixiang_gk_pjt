import type mysql from 'mysql2/promise'

type Connection=Pick<mysql.Connection,'query'>

export async function migrateFamilyCompanion(connection:Connection,databaseName:string){
  if(!/^[a-zA-Z0-9_]+$/.test(databaseName))throw new Error('数据库名称不合法')
  const db=`\`${databaseName}\``
  await connection.query(`CREATE TABLE IF NOT EXISTS ${db}.profile_score_snapshots (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,profile_id CHAR(36) NOT NULL,exam_name VARCHAR(64) NOT NULL,exam_date DATE NOT NULL,
    score SMALLINT UNSIGNED NULL,province_rank INT UNSIGNED NULL,note VARCHAR(200) NULL,is_current TINYINT(1) NOT NULL DEFAULT 0,
    origin_key VARCHAR(80) NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uk_score_snapshot_origin(origin_key),
    KEY idx_score_snapshot_timeline(profile_id,exam_date,id),KEY idx_score_snapshot_current(profile_id,is_current),
    CONSTRAINT fk_score_snapshot_profile FOREIGN KEY(profile_id) REFERENCES ${db}.student_profiles(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`)
  await connection.query(`INSERT IGNORE INTO ${db}.profile_score_snapshots(profile_id,exam_name,exam_date,score,province_rank,is_current,origin_key,created_at)
    SELECT sp.id,'建档坐标',DATE(sp.created_at),sp.score,sp.province_rank,1,CONCAT('baseline:',sp.id),sp.created_at
    FROM ${db}.student_profiles sp WHERE NOT EXISTS(SELECT 1 FROM ${db}.profile_score_snapshots ss WHERE ss.profile_id=sp.id)`)
}
