const functions = require("firebase-functions");

process.env.SQREEN_APP_NAME = functions.config().sqreen.app.name;
process.env.SQREEN_TOKEN = functions.config().sqreen.token;

require("sqreen");

const { binaryToSpaces, spacesToBinary } = require("./util/conversion");
const admin = require("firebase-admin");
admin.initializeApp();

const firestore = admin.firestore();
const urls = firestore.collection("urls");

const cors = require("cors")({ origin: true });

exports.getURL = functions.https.onRequest(async (req, res) => {
  cors(req, res, () => {});

  const short = req.params["0"];

  if (short) {
    if (typeof short === "string") {
      // Remove any Zs (used to mark the end of the URL to applications) and then convert it to binary
      const binary = spacesToBinary(short.replace(/Z/i, ""));

      const doc = await urls.doc(binary).get();
      const data = doc.data();

      if (doc.exists) {
        // Increase the usage counter for this link by one in the background
        doc.ref.update({
          "stats.get": admin.firestore.FieldValue.increment(1)
        });

        return res.redirect(data.url);
      } else {
        return res.status(404).end();
      }
    } else {
      return res
        .status(400)
        .json({ error: "Short ID must be string type" })
        .end();
    }
  } else {
    return res
      .status(400)
      .json({ error: "You must specify a short ID" })
      .end();
  }
});

exports.shortenURL = functions.https.onRequest(async (req, res) => {
  cors(req, res, () => {});

  const { url } = req.query;

  if (url) {
    let urlInstance;
    if (typeof url === "string") {
      try {
        urlInstance = new URL(url);
      } catch (error) {
        return res
          .status(400)
          .json({ error: "Not a valid URL" })
          .end();
      }

      if (
        [
          "zws.im",
          "zero-width-shortener.firebaseapp.com",
          "zero-width-shortener.web.app",
          "zws.jonahsnider.ninja"
        ].includes(urlInstance.hostname)
      ) {
        return res.status(400).json({
          error: "Shortening a URL containing the URL shortener's hostname is disallowed"
        });
      }

      if (url.length > 500) {
        return res
          .status(413)
          .json({ error: "URL can not exceed 500 characters" })
          .end();
      }

      // Find documents that have the same long URL (duplicates)
      const { docs } = await urls.where("url", "==", url).get();
      const [entry] = docs;

      if (entry) {
        // Someone already shortened this URL so give the old one to them

        // Increase the usage counter for this link by one in the background
        entry.ref.update({
          "stats.shorten": admin.firestore.FieldValue.increment(1)
        });

        return res
          .status(200)
          .json({ short: binaryToSpaces(entry.id) })
          .end();
      } else {
        // This is a new URL so enter it into the database

        // Count is a number used for generating the short ID
        const countDoc = firestore.collection("settings").doc("short");
        const { count } = (await countDoc.get()).data();

        // The math here converts the number to binary (decimal => binary string => binary number)
        const short = `${binaryToSpaces(parseInt(Number(count).toString(2), 10))}Z`;

        await Promise.all([
          // Set the shortened URL document
          urls.doc(Number(count).toString(2)).set({ url, stats: { get: 0, shorten: 1 } }),
          // Set the count to be one higher
          countDoc.update({ count: admin.firestore.FieldValue.increment(1) })
        ]);

        return res
          .status(201)
          .json({ short })
          .end();
      }
    } else {
      return res
        .status(400)
        .json({ error: "URL must be string type" })
        .end();
    }
  } else {
    return res
      .status(400)
      .json({ error: "You must specify a URL" })
      .end();
  }
});
