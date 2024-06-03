const express = require("express");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = process.env.PORT || 3002;

const kafka = new Kafka({
  clientId: "price-calculator",
  brokers: [
    "kafka-release.kafka.svc.cluster.local:9092",
    "kafka-release-0.kafka-release-headless.kafka.svc.cluster.local:9092",
  ],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "price-calculator-group" });

function getFoodPrice(foodName, restaurant) {
  return restaurant.foods.find((food) => food.name === foodName).price;
}

const runKafka = async () => {
  let driver = undefined;
  let restaurant = undefined;
  let food = undefined;

  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "request-data", fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const key = message.key.toString();
      const value = JSON.parse(message.value.toString());
      if (key === "price") {
        food = value.food;
        await producer.send({
          topic: "request-data",
          messages: [
            { key: "find-restaurant", value: JSON.stringify({ food }) },
          ],
        });
      } else if (key === "result") {
        driver = value.driver;
        restaurant = value.restaurant;

        if (
          driver == null ||
          driver == undefined ||
          restaurant == undefined ||
          restaurant == null ||
          food == null ||
          food == undefined
        ) {
          await producer.send({
            topic: "request-data",
            messages: [
              { key: "price", value: JSON.stringify({ price: null }) },
            ],
          });
          return;
        }

        const price = driver.rate + getFoodPrice(food, restaurant);
        await producer.send({
          topic: "response-data",
          messages: [{ key: "price", value: JSON.stringify(price) }],
        });
      }
    },
  });
};

runKafka().catch(console.error);

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
