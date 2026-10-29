UPDATE `age_bands` SET `max_age` = 34 WHERE `code` = 'senior' AND `min_age` = 18 AND `max_age` IS NULL
  AND EXISTS (SELECT 1 FROM `age_bands` AS `v` WHERE `v`.`competition_id` = `age_bands`.`competition_id` AND `v`.`code` = 'v1' AND `v`.`min_age` = 35);
