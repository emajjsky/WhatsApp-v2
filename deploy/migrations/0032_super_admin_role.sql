ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin', 'admin', 'user'));

UPDATE users SET role = 'super_admin', updated_at = NOW()
WHERE LOWER(email) = 'admin@example.com';

CREATE UNIQUE INDEX users_single_super_admin ON users (role) WHERE role = 'super_admin';
ALTER TABLE users ADD CONSTRAINT users_super_admin_email_check
    CHECK ((role = 'super_admin') = (LOWER(email) = 'admin@example.com'));
