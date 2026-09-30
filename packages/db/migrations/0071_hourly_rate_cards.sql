UPDATE rate_cards SET effective_to = now() WHERE rate_type <> 'hourly' AND (effective_to IS NULL OR effective_to > now());--> statement-breakpoint
ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_hourly_only_chk CHECK (rate_type = 'hourly') NOT VALID;
