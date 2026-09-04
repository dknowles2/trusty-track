-- A GrandPrix Race Manager (v18+) database, as SQL rather than as the file.
--
-- Synthesised, not recorded — see NOTICE.md. The three tables carry exactly
-- the columns DerbyNet's GPRM-compatible SQLite schema gives them
-- (website/sql/sqlite/schema.inc), and the rows are chosen to exercise every
-- branch of domain/gprm.py:
--
--   * Wolves and Bears each have one rank named the same as the class (GPRM's
--     default) — no category — plus "Den 1" under both, which collides.
--   * Webelos has two distinct ranks, Den 4 and Den 5, categorised "Webelos".
--   * Siblings is a class with no rank at all.
--   * Racer 6 points at a rank that no longer exists and falls back to their
--     class; racer 7 has no last name; racer 8 duplicates racer 1's number;
--     racer 9 is unnumbered (0) and excluded from standings; racer 10 has a
--     text car number.
--   * Two racers have photo filenames.

CREATE TABLE `Classes` (
  `classid` INTEGER PRIMARY KEY,
  `class` VARCHAR(75) NOT NULL UNIQUE COLLATE NOCASE,
  `sortorder` INTEGER
);

CREATE TABLE `Ranks` (
  `rankid` INTEGER PRIMARY KEY,
  `rank` VARCHAR(75) NOT NULL COLLATE NOCASE,
  `classid` INTEGER NOT NULL,
  `sortorder` INTEGER
);

CREATE TABLE `RegistrationInfo` (
  `racerid` INTEGER PRIMARY KEY,
  `carnumber` INTEGER NOT NULL,
  `carname` VARCHAR(30),
  `lastname` VARCHAR(30) NOT NULL COLLATE NOCASE,
  `firstname` VARCHAR(30) NOT NULL COLLATE NOCASE,
  `classid` INTEGER NOT NULL,
  `rankid` INTEGER NOT NULL,
  `passedinspection` TINYINT(1) DEFAULT 0,
  `imagefile` VARCHAR(255),
  `carphoto` VARCHAR(255),
  `exclude` TINYINT(1) DEFAULT 0
);

-- Every GPRM database carries these settings; the importer ignores them, and
-- they are here so the fixture is the shape of a real file rather than the
-- minimum the parser reads.
CREATE TABLE `RaceInfo` (
  `raceinfoid` INTEGER PRIMARY KEY,
  `itemkey` VARCHAR(20) NOT NULL,
  `itemvalue` VARCHAR(200)
);
INSERT INTO RaceInfo (itemkey, itemvalue) VALUES ('schema', '2');
INSERT INTO RaceInfo (itemkey, itemvalue) VALUES ('lane_count', '4');

-- sortorder puts Bears before Wolves, against their ids.
INSERT INTO Classes (classid, class, sortorder) VALUES (1, 'Wolves', 2);
INSERT INTO Classes (classid, class, sortorder) VALUES (2, 'Bears', 1);
INSERT INTO Classes (classid, class, sortorder) VALUES (3, 'Webelos', 3);
INSERT INTO Classes (classid, class, sortorder) VALUES (4, 'Siblings', 4);

INSERT INTO Ranks (rankid, rank, classid, sortorder) VALUES (1, 'Wolves', 1, 1);
INSERT INTO Ranks (rankid, rank, classid, sortorder) VALUES (2, 'Den 1', 1, 2);
INSERT INTO Ranks (rankid, rank, classid, sortorder) VALUES (3, 'Bears', 2, 1);
INSERT INTO Ranks (rankid, rank, classid, sortorder) VALUES (4, 'Den 1', 2, 2);
INSERT INTO Ranks (rankid, rank, classid, sortorder) VALUES (5, 'Den 4', 3, 1);
INSERT INTO Ranks (rankid, rank, classid, sortorder) VALUES (6, 'Den 5', 3, 2);

INSERT INTO RegistrationInfo
  (racerid, carnumber, carname, lastname, firstname, classid, rankid, passedinspection, imagefile, carphoto, exclude)
VALUES
  (1, 101, 'Blue Streak', 'Rivera', 'Alex', 1, 1, 1, 'rivera.jpg', NULL, 0),
  (2, 102, NULL, 'Chen', 'Morgan', 1, 2, 0, NULL, 'car-102.jpg', 0),
  (3, 201, 'Thunder', 'Okafor', 'Sam', 2, 3, 1, NULL, NULL, 0),
  (4, 202, ' Lightning ', 'Patel', 'Riley', 2, 4, 0, NULL, NULL, 0),
  (5, 301, 'Rocket', 'Nguyen', 'Jordan', 3, 5, 1, NULL, NULL, 0),
  (6, 302, 'Comet', 'Garcia-Lopez', 'Casey', 3, 99, 0, NULL, NULL, 0),
  (7, 303, 'Nameless', '', 'Drew', 3, 6, 0, NULL, NULL, 0),
  (8, 101, 'Copycat', 'Kim', 'Taylor', 3, 6, 0, NULL, NULL, 0),
  (9, 0, 'Dad''s Car', 'Rivera', 'Pat', 4, 0, 1, NULL, NULL, 1),
  (10, 'ABC', 'Mystery', 'Singh', 'Avery', 4, 0, 0, NULL, NULL, 0);
