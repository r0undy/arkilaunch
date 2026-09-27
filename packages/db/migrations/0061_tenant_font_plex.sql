-- Hand-authored, expand-only (CR: cr-arkilaunch-aws-design-language.md).
-- Inter becomes the design-system default (NULL); 'plex' lets a tenant keep
-- IBM Plex. Widening the CHECK is safe for the old API revision, which reads
-- any value other than 'inter' as NULL (its default, Plex).
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_font_known;--> statement-breakpoint
ALTER TABLE tenants ADD CONSTRAINT tenants_font_known
  CHECK (font IS NULL OR font IN ('inter', 'plex'));
