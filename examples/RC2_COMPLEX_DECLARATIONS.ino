#include <Arduino.h>

struct Sample {
  int value;
  explicit Sample(int v) : value(v) {}
};

// Проверка ограничений парсера: не использовать как подтверждённую изоляцию.
Sample items[2] = {Sample(1), Sample(2)};
Sample* active = &items[0];

bool Enable = true; // in
int Out = 0; // out

void setup() {}
void loop() {
  if (Enable) Out = active->value;
}
