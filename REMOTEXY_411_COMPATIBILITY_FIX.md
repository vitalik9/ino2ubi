# RemoteXY 4.1.11 / FLProg compatibility check

Target: RemoteXY library 4.1.11 (verified in uploaded `library.properties`), ESP32 Core 2.0.17, Code Professional.

Changes:
- Generated GUI structure is enclosed in `#pragma pack(push, 1)` / `#pragma pack(pop)`, matching the original RemoteXY editor. No global/outer `__attribute__((packed))` is used for C++ complex class members.
- When NotificationNet is present, generator lists `<EEPROM.h>` before `<RemoteXY.h>`. RemoteXY.h detects `EEPROM_h` at inclusion time and enables `REMOTEXY_HAS_EEPROM` accordingly.
- The generator initializes library EEPROM after `addGui` / cloud setup and before `Preferences` restores persisted GUI values. The RemoteXY library registers notification network boardId/aesKey service items in `RemoteXYType_NotificationNet::init`.
- Ordinary Notification (not NotificationNet) does not by itself require service EEPROM.
- Existing removal of GUI EEPROM descriptors and NVS storage for saved fields is unchanged.

IMPORTANT: FLProg may reorder include statements while assembling its project. Inspect the compiled `pr*.ino`: if `<RemoteXY.h>` appears before `<EEPROM.h>` in a project with NotificationNet, service EEPROM **will not be enabled** by RemoteXY 4.1.11. Correct include order in the FLProg project is mandatory; the emitted .ubi order alone does not prove this.

Tests: JavaScript regression tests validate generation, not real C++ compilation or binary layout on hardware. Real FLProg compile and ESP32 integration tests (Cloud, NotificationNet, reboot/persistence) remain outstanding.

Known limitations: one RemoteXY block per project, no input En; NVS namespace `rxy-state` is fixed; concurrent RemoteXY blocks would conflict. Cloud credentials are exported as block parameters and should not be published.
