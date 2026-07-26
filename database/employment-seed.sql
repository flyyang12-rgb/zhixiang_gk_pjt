USE zhixiang;

INSERT INTO majors (code,name,category,holland_types,career_tags) VALUES
('080901','计算机科学与技术','工学',JSON_ARRAY('I','R','C'),JSON_ARRAY('数字技术','软件')),
('080601','电气工程及其自动化','工学',JSON_ARRAY('R','I','C'),JSON_ARRAY('电力','自动化')),
('080202','机械设计制造及其自动化','工学',JSON_ARRAY('R','I','C'),JSON_ARRAY('制造','装备')),
('120203K','会计学','管理学',JSON_ARRAY('C','E','I'),JSON_ARRAY('财务','审计')),
('101101','护理学','医学',JSON_ARRAY('S','C','R'),JSON_ARRAY('医疗','健康')),
('100201K','临床医学','医学',JSON_ARRAY('I','S','R'),JSON_ARRAY('医疗','临床')),
('030101K','法学','法学',JSON_ARRAY('E','S','I'),JSON_ARRAY('法律','合规')),
('050101','汉语言文学','文学',JSON_ARRAY('A','S','C'),JSON_ARRAY('教育','内容')),
('070101','数学与应用数学','理学',JSON_ARRAY('I','C','R'),JSON_ARRAY('数学','数据'))
ON DUPLICATE KEY UPDATE name=VALUES(name),category=VALUES(category),holland_types=VALUES(holland_types),career_tags=VALUES(career_tags);

INSERT INTO job_directions (code,employment_category,name,aliases,requires_postgraduate,requires_certificate,reviewed_at) VALUES
('software_dev','技术研发','软件开发',JSON_ARRAY('软件工程师','软件开发','后端开发','前端开发','Java开发','客户端开发'),0,0,NOW()),
('software_quality','技术研发','测试与运维',JSON_ARRAY('测试工程师','软件测试','运维工程师','系统运维','质量保障工程师'),0,0,NOW()),
('data_engineering','技术研发','数据开发',JSON_ARRAY('数据开发工程师','数据工程师','数据库开发','ETL工程师'),0,0,NOW()),
('electrical_engineer','工程制造','电气工程',JSON_ARRAY('电气工程师','电气设计','电气技术员'),0,0,NOW()),
('control_engineer','工程制造','自动化控制',JSON_ARRAY('自动化工程师','控制工程师','PLC工程师','电气自动化'),0,0,NOW()),
('power_operations','工程制造','电力运维',JSON_ARRAY('电力运维','配电工程师','电网运维','变电运维'),0,1,NOW()),
('mechanical_design','工程制造','机械设计',JSON_ARRAY('机械设计工程师','机械工程师','结构设计工程师'),0,0,NOW()),
('process_equipment','工程制造','工艺与设备',JSON_ARRAY('工艺工程师','设备工程师','制造工程师'),0,0,NOW()),
('equipment_maintenance','工程制造','设备维护',JSON_ARRAY('设备维护工程师','机械维修','设备技术员'),0,0,NOW()),
('accounting','财务审计','会计核算',JSON_ARRAY('会计','核算会计','总账会计','财务会计'),0,1,NOW()),
('audit','财务审计','审计',JSON_ARRAY('审计助理','审计专员','内部审计'),0,1,NOW()),
('tax','财务审计','税务',JSON_ARRAY('税务专员','税务会计','税务助理'),0,1,NOW()),
('clinical_nursing','医疗健康','临床护理',JSON_ARRAY('护士','临床护士','护理人员'),0,1,NOW()),
('community_health','医疗健康','社区健康',JSON_ARRAY('社区护士','社区健康管理','基层护理'),0,1,NOW()),
('elder_care','医疗健康','养老护理管理',JSON_ARRAY('养老护理','护理管理','康养护理'),0,1,NOW()),
('clinical_physician','医疗健康','临床医师',JSON_ARRAY('临床医师','住院医师','全科医师'),1,1,NOW()),
('primary_physician','医疗健康','基层医疗',JSON_ARRAY('基层医师','乡村医生','社区医师'),0,1,NOW()),
('medical_research','医疗健康','医学研究',JSON_ARRAY('医学研究员','临床研究员','科研助理'),1,0,NOW()),
('legal_assistant','公共服务','法律实务',JSON_ARRAY('法务助理','律师助理','法律顾问助理'),0,1,NOW()),
('compliance','经营管理','合规风控',JSON_ARRAY('合规专员','风控专员','内控专员'),0,0,NOW()),
('legal_public_service','公共服务','公共法律服务',JSON_ARRAY('法律事务','司法辅助','行政执法'),0,1,NOW()),
('language_teacher','教育培训','语文教育',JSON_ARRAY('语文教师','语文老师','教研员'),0,1,NOW()),
('content_editor','设计内容','内容编辑',JSON_ARRAY('内容编辑','文字编辑','新媒体编辑','文案编辑'),0,0,NOW()),
('administrative_writing','公共服务','行政文秘',JSON_ARRAY('行政文员','文秘','综合文员','材料撰写'),0,0,NOW()),
('data_analysis','技术研发','数据分析',JSON_ARRAY('数据分析师','商业分析师','数据运营'),0,0,NOW()),
('math_teacher','教育培训','数学教育',JSON_ARRAY('数学教师','数学老师','数学教研'),0,1,NOW()),
('operations_analysis','经营管理','运营分析',JSON_ARRAY('运营分析','经营分析','策略运营'),0,0,NOW())
ON DUPLICATE KEY UPDATE employment_category=VALUES(employment_category),name=VALUES(name),aliases=VALUES(aliases),requires_postgraduate=VALUES(requires_postgraduate),requires_certificate=VALUES(requires_certificate),reviewed_at=VALUES(reviewed_at);

INSERT INTO major_job_directions (major_id,job_direction_id,priority,direct_entry,review_status)
SELECT m.id,j.id,x.priority,x.direct_entry,'approved' FROM (
 SELECT '080901' major_code,'software_dev' job_code,1 priority,1 direct_entry UNION ALL SELECT '080901','software_quality',2,1 UNION ALL SELECT '080901','data_engineering',3,1 UNION ALL
 SELECT '080601','electrical_engineer',1,1 UNION ALL SELECT '080601','control_engineer',2,1 UNION ALL SELECT '080601','power_operations',3,1 UNION ALL
 SELECT '080202','mechanical_design',1,1 UNION ALL SELECT '080202','process_equipment',2,1 UNION ALL SELECT '080202','equipment_maintenance',3,1 UNION ALL
 SELECT '120203K','accounting',1,1 UNION ALL SELECT '120203K','audit',2,1 UNION ALL SELECT '120203K','tax',3,1 UNION ALL
 SELECT '101101','clinical_nursing',1,1 UNION ALL SELECT '101101','community_health',2,1 UNION ALL SELECT '101101','elder_care',3,1 UNION ALL
 SELECT '100201K','clinical_physician',1,0 UNION ALL SELECT '100201K','primary_physician',2,0 UNION ALL SELECT '100201K','medical_research',3,0 UNION ALL
 SELECT '030101K','legal_assistant',1,1 UNION ALL SELECT '030101K','compliance',2,1 UNION ALL SELECT '030101K','legal_public_service',3,1 UNION ALL
 SELECT '050101','language_teacher',1,1 UNION ALL SELECT '050101','content_editor',2,1 UNION ALL SELECT '050101','administrative_writing',3,1 UNION ALL
 SELECT '070101','data_analysis',1,1 UNION ALL SELECT '070101','math_teacher',2,1 UNION ALL SELECT '070101','operations_analysis',3,1
) x JOIN majors m ON m.code=x.major_code JOIN job_directions j ON j.code=x.job_code
ON DUPLICATE KEY UPDATE priority=VALUES(priority),direct_entry=VALUES(direct_entry),review_status='approved';

INSERT INTO job_sources(name,source_type,base_url,access_policy_url,collection_policy,status) VALUES
('国家大学生就业服务平台','official','https://www.ncss.cn/student/jobs/jobslist/ajax/','https://www.ncss.cn/student/jobs/index.html','公开职位列表接口；无需登录；每日按9个审核岗位词各取1页20条；不采集简历或个人信息。','degraded'),
('中国公共招聘网','official','http://job.mohrss.gov.cn/cjobs/jobinfolist/listJobinfolist','http://job.mohrss.gov.cn/cjobs/jobfairinfo/wzsyzn','公开招聘岗位页面；无需登录；每日按9个审核岗位词各取1页20条；不采集联系人和联系电话。','degraded')
ON DUPLICATE KEY UPDATE source_type=VALUES(source_type),base_url=VALUES(base_url),access_policy_url=VALUES(access_policy_url),collection_policy=VALUES(collection_policy),status=IF(status='paused','paused',status);
