-- A DerbyNet database, as SQL rather than as the file.
--
-- Schema-derived, not pack-derived -- see NOTICE.md before trusting this
-- further than it goes. The five tables below are transcribed from
-- DerbyNet's own committed DDL rather than from its documentation:
--
--   * `website/sql/sqlite/schema.inc` (Classes, Ranks, RegistrationInfo,
--     RaceInfo)
--   * `website/sql/sqlite/partitions.inc` (Partitions)
--
-- at commit ddf91117751d42fe1e331227d6cfd7e1dc928143 of
-- https://github.com/jeffpiazza/derbynet (MIT, (c) Jeff Piazza), where
-- `website/inc/schema_version.inc` fixes `expected_schema_version()` at 10.
-- schema.inc builds each CREATE TABLE by string concatenation with
-- version-gated ternaries (`expected_schema_version() < N ? "" : "..."`);
-- since that function is a hardcoded literal at this commit, every ternary
-- resolves to one fixed answer, and each is called out below so the
-- resolution can be checked against the source rather than trusted. No PHP
-- interpreter was available to execute the file directly (see NOTICE.md);
-- this is that resolution done by hand against the quoted source, not a
-- recorded `.sqlite` and not a live run of schema.inc.
--
--   * Classes: `constituents`/`durable`/`ntrophies` require version >= 3;
--     `rankids` (nested inside that) requires >= 5; `sortorder` requires
--     >= 2. All four hold at 10.
--   * Ranks: `ntrophies` requires >= 10 (exactly met); `sortorder` requires
--     >= 2.
--   * RegistrationInfo: `partitionid` is NOT NULL unconditionally -- no
--     version gate at all, unlike every other column here. `carphoto`
--     requires >= 2; `checkin_time` requires >= REGISTRATION_CHECKIN_SCHEMA,
--     which schema_version.inc also pins at 10 -- exactly met, so this is
--     the version at which DerbyNet started carrying a check-in timestamp
--     alongside the boolean `passedinspection`. `note` is unconditional.
--   * RaceInfo: `itemvalue` is VARCHAR(200) at version >= 2 (VARCHAR(50)
--     below it).
--   * Partitions carries no version gates at all.
--
-- What running these statements against our prior, documentation-inferred
-- guess actually found: every column domain/gprm.py and domain/derbynet.py
-- read -- `class`, `rank`, `classid`/`rankid`/`sortorder`, and on
-- RegistrationInfo `racerid`/`carnumber`/`carname`/`lastname`/`firstname`/
-- `classid`/`rankid`/`passedinspection`/`imagefile`/`carphoto`/`exclude` --
-- match the real schema exactly: same name, same type, same nullability.
-- Nothing the importer reads was wrong. The real schema carries five columns
-- our prior fixture omitted, none of which either importer reads:
-- `Classes.durable`, `Classes.ntrophies`, `Ranks.ntrophies`,
-- `RegistrationInfo.checkin_time` and `RegistrationInfo.note`. They are
-- included below with values on a couple of rows so the fixture proves the
-- parsers ignore them rather than merely omitting the temptation to choke on
-- them. The other genuine difference is that `partitionid` is `NOT NULL` in
-- the real schema; our synthesised guess left it nullable. Every row below
-- already supplies one, so nothing about the scenario changes -- the
-- comment is here because a *reader* extending this fixture with an
-- unpartitioned racer needs to know the real table will refuse the insert,
-- where the old fixture would have silently accepted it.
--
-- The scenario is unchanged from the fixture this replaces, and still
-- exercises domain/derbynet.py's one addition over domain/gprm.py: the
-- `Partitions` table.
--
--   * Wolves and Bears are each a class/rank/partition all sharing one name
--     (DerbyNet's own "by-partition" default, GPRM's default shape too) --
--     no category, same as domain/gprm.py already gives GPRM.
--   * Webelos has two distinct dens, Den 4 and Den 5, categorised "Webelos".
--   * Siblings' own rank is named `siblings-legacy` -- stale against its
--     `Partitions` row, which names it `Siblings`. The importer must read
--     the *partition's* name, not the rank's, and land on no category
--     (the partition's name matches its class, same as Wolves and Bears).
--   * Grand Finals is a DerbyNet aggregate class (non-empty `constituents`,
--     `durable = 1` since it was created explicitly rather than implicitly
--     by an aggregate round) and holds no racers of its own -- domain/gprm.py
--     already skips it.
--   * Racer 5 is excluded from standings (`exclude = 1`) but still raced --
--     DerbyNet's own source (`website/inc/standings.inc`,
--     `website/ajax/action.racer.bulk.inc`) confirms `exclude` filters a
--     racer's row out of the standings/trophy queries
--     (`WHERE passedinspection = 1 AND exclude = 0`) while a separate query
--     counts how many "ineligible" racers were left out -- the racer still
--     has `passedinspection = 1` and races. DerbyNet's own roster-import
--     screen labels the column "Ineligible for Award?"
--     (`website/import-roster.php`). That is DerbyNet's own intended
--     behaviour, read from its source rather than from a pack's file, and it
--     matches Trusty Track's `excluded_from_standings` (#548): still races,
--     only ranking is different. It is corroborating evidence, not the
--     real-pack-data proof the issue asks for -- a pack could still use the
--     checkbox differently than the software intends.
--   * Two racers have photo filenames, so the photo-warning problem names
--     DerbyNet rather than GrandPrix Race Manager.
--   * Racer 5 also carries a `checkin_time` and a `note`, columns the real
--     schema has that neither importer maps to anything -- present here so
--     a reader can see they come through as ordinary, harmlessly-unread row
--     values rather than being a reason the parser trips.

CREATE TABLE `Classes` (
  `classid` INTEGER PRIMARY KEY,
  `class` VARCHAR(75) NOT NULL UNIQUE COLLATE NOCASE,
  `constituents` VARCHAR(100) DEFAULT '',
  `rankids` VARCHAR(100) DEFAULT '',
  `durable` INTEGER,
  `ntrophies` INTEGER DEFAULT -1,
  `sortorder` INTEGER
);

CREATE TABLE `Ranks` (
  `rankid` INTEGER PRIMARY KEY,
  `rank` VARCHAR(75) NOT NULL COLLATE NOCASE,
  `classid` INTEGER NOT NULL,
  `ntrophies` INTEGER DEFAULT -1,
  `sortorder` INTEGER
);

CREATE TABLE Partitions (
  partitionid INTEGER PRIMARY KEY,
  name VARCHAR(200) UNIQUE,
  rankid INTEGER,
  sortorder INTEGER
);

CREATE TABLE `RegistrationInfo` (
  `racerid` INTEGER PRIMARY KEY,
  `carnumber` INTEGER NOT NULL,
  `carname` VARCHAR(30),
  `lastname` VARCHAR(30) NOT NULL COLLATE NOCASE,
  `firstname` VARCHAR(30) NOT NULL COLLATE NOCASE,
  `classid` INTEGER NOT NULL,
  `rankid` INTEGER NOT NULL,
  `partitionid` INTEGER NOT NULL,
  `passedinspection` TINYINT(1) DEFAULT 0,
  `imagefile` VARCHAR(255),
  `carphoto` VARCHAR(255),
  `checkin_time` INTEGER,
  `note` VARCHAR(255),
  `exclude` TINYINT(1) DEFAULT 0
);

-- Every DerbyNet database carries this settings table; the importer ignores
-- it, and it is here so the fixture is the shape of a real backup rather
-- than the minimum the parser reads. `schema` is the row a real install
-- actually gets at first creation (schema.inc's own final INSERT); the
-- other two are what our prior fixture already carried.
CREATE TABLE `RaceInfo` (
  `raceinfoid` INTEGER PRIMARY KEY,
  `itemkey` VARCHAR(20) NOT NULL,
  `itemvalue` VARCHAR(200)
);
INSERT INTO RaceInfo (itemkey, itemvalue) VALUES ('schema', '10');
INSERT INTO RaceInfo (itemkey, itemvalue) VALUES ('group-formation-rule', 'by-partition');
INSERT INTO RaceInfo (itemkey, itemvalue) VALUES ('partition-label', 'Den');

INSERT INTO Classes (classid, class, constituents, sortorder) VALUES (1, 'Wolves', '', 1);
INSERT INTO Classes (classid, class, constituents, sortorder) VALUES (2, 'Bears', '', 2);
INSERT INTO Classes (classid, class, constituents, sortorder) VALUES (3, 'Webelos', '', 3);
INSERT INTO Classes (classid, class, constituents, sortorder) VALUES (4, 'Siblings', '', 4);
INSERT INTO Classes (classid, class, constituents, durable, sortorder) VALUES (5, 'Grand Finals', '1,2', 1, 5);

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
  (racerid, carnumber, carname, lastname, firstname, classid, rankid, partitionid, passedinspection, imagefile, carphoto, checkin_time, note, exclude)
VALUES
  (1, 101, 'Blue Streak', 'Rivera', 'Alex', 1, 1, 1, 1, 'rivera.jpg', NULL, NULL, NULL, 0),
  (2, 201, 'Thunder', 'Okafor', 'Sam', 2, 2, 2, 1, NULL, 'car-201.jpg', NULL, NULL, 0),
  (3, 301, 'Rocket', 'Nguyen', 'Jordan', 3, 3, 3, 1, NULL, NULL, NULL, NULL, 0),
  (4, 302, 'Comet', 'Patel', 'Riley', 3, 4, 4, 0, NULL, NULL, NULL, NULL, 0),
  (5, 401, 'Dad''s Car', 'Kim', 'Pat', 4, 5, 5, 1, NULL, NULL, 1735689600, 'Sibling entry, raced but not judged', 1);
