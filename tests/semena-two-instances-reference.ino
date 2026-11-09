/* Restored from first instance of the actual FLProg output; for converter regression only. */
#include "flprogUtilites.h"
#include <math.h>
#include <Preferences.h>
#include <Arduino.h>
bool Out_182024563; // out
float Out_112065038; // out
float Out_209348469; // out
float Out_172334440; // out
float Out_163923836; // out
int Out_237282937; // out
bool Out_206308192; // out
float Out_122402102; // out
float Out_128643170; // out
float Out_125812646; // out
float Out_127820063; // out
Preferences prefs;
bool lstRst = false; // variable
bool lstImp = false; // variable
bool lstCalib = false; // variable
int blkId = 0; // variable
int blkCrop = 0; // variable
int lstId = -1; // variable
int lstCrop = -1; // variable
bool trigFired = false; // variable
int trigPctClamped = 40; // variable
float curTemp = 0.0f; // variable
float radCorr = 0.0f; // variable
float coverCorr = 0.0f; // variable
float rawTgt = 80.0f; // variable
float effTemp = 0.0f; // variable
float rowL = 0.0f; // variable
float arcW = 0.0f; // variable
float arcH = 0.0f; // variable
float arcLen = 0.0f; // variable
bool tempValid = false; // variable
bool calibValid = false; // variable
bool resetEvent = false; // variable
bool hourEvent = false; // variable
bool calibEvent = false; // variable
bool profileChanged = false; // variable
bool nvsReady = false; // variable
bool nvsWriteReady = false; // variable
String activeNamespace = ""; // variable
String requestedNamespace = ""; // variable
String keyStr = ""; // variable
String trigKeyStr = ""; // variable
String calibKeyStr = ""; // variable
bool semenaValidNumber(float value) {
return isfinite(value);
}

void semenaPrepareProfile() {
{
  String nvsNamespace = "seed_set";
blkId = (0);

  if (blkId < 0) {
    blkId = 0;
  }

  blkCrop = (0);

  if (blkCrop < 0 || blkCrop > 2) {
    blkCrop = 0;
  }

  requestedNamespace = String(nvsNamespace);

  profileChanged = false;

  if (blkId != lstId) {
    profileChanged = true;
  }

  if (blkCrop != lstCrop) {
    profileChanged = true;
  }

  if (requestedNamespace != activeNamespace) {
    profileChanged = true;
  }

  if (profileChanged) {
    lstId = blkId;
    lstCrop = blkCrop;
    activeNamespace = requestedNamespace;

    keyStr = "s" + String(blkId) + "_" + String(blkCrop);
    trigKeyStr = "t" + String(blkId) + "_" + String(blkCrop);
    calibKeyStr = "c_" + String(blkId);

    Out_112065038 = 0.0f;
    Out_127820063 = 0.0f;
    trigFired = false;

    nvsReady = false;

    if (activeNamespace.length() > 0 &&
        activeNamespace.length() <= 15) {

      if (prefs.begin(activeNamespace.c_str(), true)) {
        Out_112065038 = prefs.getFloat(keyStr.c_str(), 0.0f);
        trigFired = prefs.getBool(trigKeyStr.c_str(), false);
        Out_127820063 = prefs.getFloat(calibKeyStr.c_str(), 0.0f);

        prefs.end();

        nvsReady = true;
      }
    }

    if (!semenaValidNumber(Out_112065038) || Out_112065038 < 0.0f) {
      Out_112065038 = 0.0f;
      trigFired = false;
    }

    if (!semenaValidNumber(Out_127820063)) {
      Out_127820063 = 0.0f;
    }

    Out_182024563 = false;
    Out_163923836 = 0.0f;
    Out_237282937 = 0;
  }
}
}

void semenaSaveSet() {
nvsWriteReady = false;

  if (activeNamespace.length() > 0 &&
      activeNamespace.length() <= 15) {

    if (prefs.begin(activeNamespace.c_str(), false)) {
      prefs.putFloat(keyStr.c_str(), Out_112065038);
      prefs.end();

      nvsWriteReady = true;
    }
  }
}

void semenaSaveTrigger() {
nvsWriteReady = false;

  if (activeNamespace.length() > 0 &&
      activeNamespace.length() <= 15) {

    if (prefs.begin(activeNamespace.c_str(), false)) {
      prefs.putBool(trigKeyStr.c_str(), trigFired);
      prefs.end();

      nvsWriteReady = true;
    }
  }
}

void semenaSaveCalibration() {
nvsWriteReady = false;

  if (activeNamespace.length() > 0 &&
      activeNamespace.length() <= 15) {

    if (prefs.begin(activeNamespace.c_str(), false)) {
      prefs.putFloat(calibKeyStr.c_str(), Out_127820063);
      prefs.end();

      nvsWriteReady = true;
    }
  }
}

void semenaCalculateCorrections() {
radCorr = 0.0f;
  coverCorr = 0.0f;

  if ((0) &&
      semenaValidNumber((0)) &&
      (0) > 50.0f) {

    radCorr = (0) / 300.0f;
  }

  if ((0)) {
    coverCorr = 2.0f;
  }
}

void semenaCalculateTemperature() {
tempValid = semenaValidNumber((0));

  if (tempValid) {
    Out_125812646 = (0) + Out_127820063;

    Out_125812646 += radCorr;
    Out_125812646 += coverCorr;

    if (!semenaValidNumber(Out_125812646)) {
      tempValid = false;
      Out_125812646 = 0.0f;
    }
  } else {
    Out_125812646 = 0.0f;
  }
}

void semenaCalibrate() {
calibValid = false;

  if (semenaValidNumber((0)) &&
      semenaValidNumber((0))) {

    curTemp = (0) - (0);

    curTemp -= radCorr;
    curTemp -= coverCorr;

    if (semenaValidNumber(curTemp)) {
      Out_127820063 = curTemp;
      calibValid = true;

      semenaSaveCalibration();
    }
  }
}

void semenaCalculateGeometry() {
Out_122402102 = 0.0f;
  Out_128643170 = 0.0f;

  if ((0) &&
      semenaValidNumber((0)) &&
      semenaValidNumber((0)) &&
      semenaValidNumber((0))) {

    rowL = (0);
    arcW = (0);
    arcH = (0);

    if (rowL > 0.0f &&
        arcW > 0.0f &&
        arcH >= 0.0f) {

      arcLen = arcW +
               ((8.0f * arcH * arcH) /
                (3.0f * arcW));

      Out_122402102 =
          (arcLen * rowL) +
          ((4.0f / 3.0f) * arcW * arcH);

      Out_128643170 =
          ((2.0f / 3.0f) * arcW * arcH) * rowL;

      if (!semenaValidNumber(Out_122402102) ||
          Out_122402102 < 0.0f) {
        Out_122402102 = 0.0f;
      }

      if (!semenaValidNumber(Out_128643170) ||
          Out_128643170 < 0.0f) {
        Out_128643170 = 0.0f;
      }
    }
  }
}

void semenaCalculateCrop() {
rawTgt = 80.0f;

  if (blkCrop == 1) {
    Out_209348469 = 12.0f;
    rawTgt = 55.0f;
  } else if (blkCrop == 2) {
    Out_209348469 = 11.0f;
    rawTgt = 110.0f;
  } else {
    Out_209348469 = 10.0f;
    rawTgt = 80.0f;
  }

  if ((0)) {
    Out_172334440 = rawTgt * 1.15f;
  } else {
    Out_172334440 = rawTgt;
  }
}

void semenaUpdateProgress() {
if (!semenaValidNumber(Out_112065038) || Out_112065038 < 0.0f) {
    Out_112065038 = 0.0f;
  }

  if (Out_172334440 > 0.0f) {
    Out_163923836 = (Out_112065038 / Out_172334440) * 100.0f;

    if (Out_163923836 > 100.0f) {
      Out_163923836 = 100.0f;
    }

    if (Out_163923836 < 0.0f) {
      Out_163923836 = 0.0f;
    }

    Out_182024563 = (Out_112065038 >= Out_172334440);
  } else {
    Out_163923836 = 0.0f;
    Out_182024563 = false;
  }
}

void semenaUpdateStage() {
if (!(0)) {
    Out_237282937 = 0;
  } else if (Out_182024563) {
    Out_237282937 = 5;
  } else if (Out_163923836 >= 85.0f) {
    Out_237282937 = 4;
  } else if (Out_163923836 >= 50.0f) {
    Out_237282937 = 3;
  } else if (Out_163923836 >= 20.0f) {
    Out_237282937 = 2;
  } else {
    Out_237282937 = 1;
  }
}

void semenaReset() {
Out_112065038 = 0.0f;
  Out_182024563 = false;
  Out_163923836 = 0.0f;

  trigFired = false;

  semenaSaveSet();
  semenaSaveTrigger();
}

void semenaAccumulateHour() {
if (!Out_182024563 && tempValid) {
    curTemp = Out_125812646;

    if (curTemp > Out_209348469) {
      effTemp = curTemp - Out_209348469;
      effTemp /= 24.0f;

      if (semenaValidNumber(effTemp) &&
          effTemp > 0.0f) {

        curTemp = Out_112065038 + effTemp;

        if (semenaValidNumber(curTemp)) {
          Out_112065038 = curTemp;

          if (Out_112065038 > Out_172334440) {
            Out_112065038 = Out_172334440;
          }

          semenaSaveSet();
        }
      }
    }
  }
}

void semenaCheckTrigger() {
trigPctClamped = (0);

  if (trigPctClamped < 0) {
    trigPctClamped = 0;
  }

  if (trigPctClamped > 100) {
    trigPctClamped = 100;
  }

  if (trigPctClamped > 0 && !trigFired) {
    if (Out_163923836 >= (float)trigPctClamped) {
      trigFired = true;
      Out_206308192 = true;

      semenaSaveTrigger();
    }
  }
}

void setup() {
lstId = -1;
  lstCrop = -1;

  activeNamespace = "";
  requestedNamespace = "";

  lstImp = false;
  lstRst = false;
  lstCalib = false;

  Out_182024563 = false;
  Out_112065038 = 0.0f;
  Out_209348469 = 10.0f;
  Out_172334440 = 80.0f;
  Out_163923836 = 0.0f;
  Out_237282937 = 0;
  Out_206308192 = false;

  Out_122402102 = 0.0f;
  Out_128643170 = 0.0f;
  Out_125812646 = 0.0f;
  Out_127820063 = 0.0f;

  trigFired = false;
  nvsReady = false;
  nvsWriteReady = false;lstId_196201865 = -1;
}
void loop() {
Out_206308192 = false;

  resetEvent = (0) && !lstRst;
  hourEvent = (0) && !lstImp;
  calibEvent = (0) && !lstCalib;

  if ((0)) {

    semenaPrepareProfile();

    semenaCalculateCorrections();

    if (calibEvent) {
      semenaCalibrate();
    }

    semenaCalculateTemperature();

    semenaCalculateGeometry();

    semenaCalculateCrop();

    if (resetEvent) {
      semenaReset();
    }

    semenaUpdateProgress();

    if ((0)) {

      if (hourEvent && !resetEvent) {
        semenaAccumulateHour();
      }

      semenaUpdateProgress();

      semenaUpdateStage();

      if (!resetEvent) {
        semenaCheckTrigger();
      }

    } else {

      Out_163923836 = 0.0f;
      Out_237282937 = 0;

    }

  } else {

    Out_237282937 = 0;
    Out_206308192 = false;

  }

  lstImp = (0);
  lstRst = (0);
  lstCalib = (0);Out_206308192_196201865 = false;

}
