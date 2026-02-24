-- BusinessUnit 마이그레이션: 기존 42개 팀에 businessUnitId 추가
-- 기존 데이터를 보존하면서 안전하게 처리

-- Step 1: business_units 테이블 생성 (없으면)
CREATE TABLE IF NOT EXISTS business_units (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: 기존 사용자의 businessUnit 값으로 BU 레코드 생성
INSERT INTO business_units (id, name)
SELECT gen_random_uuid()::text, DISTINCT_BU."businessUnit"
FROM (SELECT DISTINCT "businessUnit" FROM users WHERE "businessUnit" IS NOT NULL AND "businessUnit" != '') AS DISTINCT_BU
ON CONFLICT (name) DO NOTHING;

-- Step 3: BU가 없는 팀을 위한 기본 BU 생성
INSERT INTO business_units (id, name) VALUES ('default-bu-id', '기타')
ON CONFLICT (name) DO NOTHING;

-- Step 4: teams 테이블에 businessUnitId 컬럼 추가 (nullable로 먼저)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'teams' AND column_name = 'businessUnitId') THEN
    ALTER TABLE teams ADD COLUMN "businessUnitId" TEXT;
  END IF;
END $$;

-- Step 5: 각 팀의 사용자 businessUnit 값으로 businessUnitId 설정
UPDATE teams t SET "businessUnitId" = (
  SELECT bu.id FROM business_units bu
  JOIN users u ON u."businessUnit" = bu.name
  WHERE u."teamId" = t.id
  LIMIT 1
) WHERE t."businessUnitId" IS NULL;

-- Step 6: 사용자가 없는 팀은 기본 BU로 설정
UPDATE teams SET "businessUnitId" = (
  SELECT id FROM business_units WHERE name = '기타'
) WHERE "businessUnitId" IS NULL;

-- Step 7: NOT NULL 제약 추가
ALTER TABLE teams ALTER COLUMN "businessUnitId" SET NOT NULL;

-- Step 8: FK 추가 (없으면)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'teams_businessUnitId_fkey' AND table_name = 'teams') THEN
    ALTER TABLE teams ADD CONSTRAINT "teams_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES business_units(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Step 9: (name, businessUnitId) 유니크 제약 추가 전 중복 이름 처리
DO $$ DECLARE
  dup_name TEXT;
  dup_id TEXT;
  counter INT;
BEGIN
  FOR dup_name IN SELECT name FROM teams GROUP BY name, "businessUnitId" HAVING COUNT(*) > 1
  LOOP
    counter := 1;
    FOR dup_id IN SELECT id FROM teams WHERE name = dup_name ORDER BY "createdAt" OFFSET 1
    LOOP
      UPDATE teams SET name = dup_name || ' (' || counter || ')' WHERE id = dup_id;
      counter := counter + 1;
    END LOOP;
  END LOOP;
END $$;

-- Step 10: 유니크 제약 추가 (없으면)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'teams_name_businessUnitId_key' AND table_name = 'teams') THEN
    ALTER TABLE teams ADD CONSTRAINT "teams_name_businessUnitId_key" UNIQUE (name, "businessUnitId");
  END IF;
END $$;

-- Step 11: BU Space 생성 (없는 BU에 대해)
INSERT INTO spaces (id, type, "ownerId", "createdAt")
SELECT gen_random_uuid()::text, 'BU', bu.id, CURRENT_TIMESTAMP
FROM business_units bu
WHERE NOT EXISTS (SELECT 1 FROM spaces WHERE type = 'BU' AND "ownerId" = bu.id);
