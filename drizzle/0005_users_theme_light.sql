-- Custom SQL migration file, put your code below! --
-- The "follow the system" theme is gone (light is the default): move existing 'system' rows to 'light'
-- before 0006 narrows chk_users_theme to ('light','dark').
UPDATE "users" SET "theme" = 'light' WHERE "theme" = 'system';
