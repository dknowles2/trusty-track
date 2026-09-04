-- A DerbyNet database, as SQL rather than as the file.
--
-- Synthesised, not recorded -- see NOTICE.md. The four tables carry exactly
-- the columns DerbyNet's own SQLite schema gives them
-- (website/sql/sqlite/{schema,partitions}.inc), and the rows exercise
-- domain/derbynet.py's one addition over domain/gprm.py: the `Partitions`
-- table.
--
--   * Wolves and Bears are each a class/rank/partition all sharing one name
--     (DerbyNet's own "by-partition" default, GPRM's default shape too) --
--     no category, same as domain/gprm.py already gives GPRM.
--   * Webelos has two distinct dens, Den 4 and Den 5, categorised "Webelos".
--   * Siblings' own rank is named `siblings-legacy` -- stale against its
--     `Partitions` row, which names it `Siblings`. The importer must read
--     the *partition's* name, not the rank's, and land on no category
--     (the partition's name matches its class, same as Wolves and Bears).
--   * Grand Finals is a DerbyNet aggregate class (non-empty `constituents`)
--     and holds no racers of its own -- domain/gprm.py already skips it.
--   * Racer 5 is excluded from standings (`exclude = 1`) but still raced --
--     DerbyNet's own standings page still counts their heats, only leaving
--     them off the trophy table, which is exactly Trusty Track's
--     `excluded_from_standings` (#548).
--   * Two racers have photo filenames, so the photo-warning problem names
--     DerbyNet rather than GrandPrix Race Manager.

CREATE TABLE `Classes` (
  `classid` INTEGER PRIMARY KEY,
  `class` VARCHAR(75) NOT NULL UNIQUE COLLATE NOCASE,
  `constituents` VARCHAR(100) DEFAULT '',
  `rankids` VARCHAR(100) DEFAULT '',
  `sortorder` INTEGER
);

CREATE TABLE `Ranks` (
  `rankid` INTEGER PRIMARY KEY,
  `rank` VARCHAR(75) NOT NULL COLLATE NOCASE,
  `classid` INTEGER NOT NULL,
  `sortorder` INTEGER
);

CREATE TABLE `Partitions` (
  `partitionid` INTEGER PRIMARY KEY,
  `name` VARCHAR(200) UNIQUE,
  `rankid` INTEGER,
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
  `partitionid` INTEGER,
  `passedinspection` TINYINT(1) DEFAULT 0,
  `imagefile` VARCHAR(255),
  `carphoto` VARCHAR(255),
  `exclude` TINYINT(1) DEFAULT 0
);

-- Every DerbyNet database carries this settings table; the importer ignores
-- it, and it is here so the fixture is the shape of a real backup rather
-- than the minimum the parser reads.
CREATE TABLE `RaceInfo` (
  `raceinfoid` INTEGER PRIMARY KEY,
  `itemkey` VARCHAR(20) NOT NULL,
  `itemvalue` VARCHAR(200)
);
INSERT INTO RaceInfo (itemkey, itemvalue) VALUES ('group-formation-rule', 'by-partition');
INSERT INTO RaceInfo (itemkey, itemvalue) VALUES ('partition-label', 'Den');

INSERT INTO Classes (classid, class, constituents, sortorder) VALUES (1, 'Wolves', '', 1);
INSERT INTO Classes (classid, class, constituents, sortorder) VALUES (2, 'Bears', '', 2);
INSERT INTO Classes (classid, class, constituents, sortorder) VALUES (3, 'Webelos', '', 3);
INSERT INTO Classes (classid, class, constituents, sortorder) VALUES (4, 'Siblings', '', 4);
INSERT INTO Classes (classid, class, constituents, sortorder) VALUES (5, 'Grand Finals', '1,2', 5);

INSERT INTO Ranks (rankid, rank, classid, sortorder) VALUES (1, 'Wolves', 1, 1);
INSERT INTO Ranks (rankid, rank, classid, sortorder) VALUES (2, 'Bears', 2, 1);
INSERT INTO Ranks (rankid, rank, classid, sortorder) VALUES (3, 'Den 4', 3, 1);
INSERT INTO Ranks (rankid, rank, classid, sortorder) VALUES (4, 'Den 5', 3, 2);
INSERT INTO Ranks (rankid, rank, classid, sortorder) VALUES (5, 'siblings-legacy', 4, 1);

INSERT INTO Partitions (partitionid, name, rankid, sortorder) VALUES (1, 'Wolves', 1, 1);
INSERT INTO Partitions (partitionid, name, rankid, sortorder) VALUES (2, 'Bears', 2, 2);
INSERT INTO Partitions (partitionid, name, rankid, sortorder) VALUES (3, 'Den 4', 3, 3);
INSERT INTO Partitions (partitionid, name, rankid, sortorder) VALUES (4, 'Den 5', 4, 4);
INSERT INTO Partitions (partitionid, name, rankid, sortorder) VALUES (5, 'Siblings', 5, 5);

INSERT INTO RegistrationInfo
  (racerid, carnumber, carname, lastname, firstname, classid, rankid, partitionid, passedinspection, imagefile, carphoto, exclude)
VALUES
  (1, 101, 'Blue Streak', 'Rivera', 'Alex', 1, 1, 1, 1, 'rivera.jpg', NULL, 0),
  (2, 201, 'Thunder', 'Okafor', 'Sam', 2, 2, 2, 1, NULL, 'car-201.jpg', 0),
  (3, 301, 'Rocket', 'Nguyen', 'Jordan', 3, 3, 3, 1, NULL, NULL, 0),
  (4, 302, 'Comet', 'Patel', 'Riley', 3, 4, 4, 0, NULL, NULL, 0),
  (5, 401, 'Dad''s Car', 'Kim', 'Pat', 4, 5, 5, 1, NULL, NULL, 1);
