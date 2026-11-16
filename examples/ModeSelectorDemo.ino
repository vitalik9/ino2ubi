/*
Название блока: ModeSelectorDemo
Назначение: пробный блок для проверки выпадающего списка параметра Mode в свойствах FLProg 9.8.6.
Параметр Mode (uint8_t): 0 — выключено, 1 — автоматически, 2 — вручную; по умолчанию 1.
Выход Out (bool): истина только при Mode=1.
Экспериментальная функция: ComboBox в UBI, реальный импорт в FLProg не проверен.
*/
#include <Arduino.h>
uint8_t Mode = 1; // par: Mode | choices: 0=Выключено; 1=Автоматически; 2=Вручную
bool Out = false; // out
void setup() { Out = false; }
void loop() { Out = (Mode == 1); }
