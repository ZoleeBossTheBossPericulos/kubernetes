const express = require("express");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = process.env.PORT || 3003;

const kafka = new Kafka({
  clientId: "api-gateway",
  brokers: [
    "kafka-release.kafka.svc.cluster.local:9092",
    "kafka-release-0.kafka-release-headless.kafka.svc.cluster.local:9092",
  ],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "api-gateway-group" });

// Function to produce messages
async function produceMessages(food) {
  await producer.connect();
  await producer.send({
    topic: "request-data",
    messages: [{ key: "price", value: JSON.stringify({ food }) }],
  });
}

// Function to consume messages
async function consumeMessages() {
  let price = undefined;

  await consumer.connect();
  await consumer.subscribe({ topic: "response-data", fromBeginning: true });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);

    consumer
      .run({
        eachMessage: async ({ message }) => {
          const key = message.key.toString();
          const value = JSON.parse(message.value.toString());

          if (key === "price") {
            price = value;
            clearTimeout(timeout);
            resolve({ price });
          } else if (key == "bad_request") {
            price = null;
            clearTimeout(timeout);
            resolve({ price: null });
          }
        },
      })
      .catch(reject);
  });

  return { price };
}

app.get("/price-calculator", async (req, res) => {
  try {
    const food = req.query.food;

    // Produce messages to request driver and restaurant data
    await produceMessages(food);

    // Consume responses
    const { price } = await consumeMessages();

    if (price == null || price == undefined) {
      return res.status(400).send("Driver or Restaurant is not available");
    }

    res.send({ price });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  } finally {
    await producer.disconnect();
    await consumer.disconnect();
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
