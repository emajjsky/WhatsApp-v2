DELETE FROM user_permissions WHERE permission = 'scripts';

ALTER TABLE user_permissions
    DROP CONSTRAINT IF EXISTS user_permissions_permission_check;

ALTER TABLE user_permissions
    ADD CONSTRAINT user_permissions_permission_check
    CHECK (permission IN ('accounts', 'chats', 'exports'));
