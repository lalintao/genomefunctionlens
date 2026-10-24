# local_data

This directory stores local-edition runtime files:

- `saved_queries/`: saved query records and categories.
- `downloads/jobs/`: download task JSON files.
- `downloads/temp/`: temporary download files.
- `downloads/archive/`: generated ZIP archives.
- `downloads/logs/`: launcher or download logs, when present.

Back up `saved_queries/` if the saved queries matter. Download archives can be
regenerated and are removed automatically after their retention period.
