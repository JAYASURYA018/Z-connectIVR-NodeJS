const express = require("express");
const multer = require("multer");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");
const app = express();
const port = 5000;
// const db = require("./db");
const SftpClient = require("ssh2-sftp-client");
const { Pool } = require("pg");
const { Client } = require("ssh2");
const ftp = require("basic-ftp");

app.use(express.json());
app.use(cors());
app.use(bodyParser.json());
// const connection = db.connection;

const pgPool = new Pool({
  user: "postgres",
  host: "10.16.7.80",
  database: "ZeniusIVR",
  password: "Zeniusit@123",
  port: 5432,
});

app.get("/", (req, res) => {
  res.send("Hello Node.js application");
});
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Parse JSON bodies
app.use(bodyParser.json());

app.post(
  "/Menunode",
  upload.fields([
    { name: "audioFile", maxCount: 1 },
    { name: "nomatchAudioFile", maxCount: 1 },
    { name: "noinputAudioFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("req.body ::", JSON.stringify(req.body));
      console.log("req.files", req.files);
      console.log("only req ::", req);

      const { id, Menuname, TexttoSay, Channel, menuoptions } = JSON.parse(
        req.body.RequestBodyforMenu
      );

      const initialAudio = req.files.audioFile
        ? req.files.audioFile[0].buffer
        : null;
      const nomatchAudio = req.files.nomatchAudioFile
        ? req.files.nomatchAudioFile[0].buffer
        : null;
      const noinputAudio = req.files.noinputAudioFile
        ? req.files.noinputAudioFile[0].buffer
        : null;

      console.log("Initial Audio:", initialAudio);
      console.log("Nomatch Audio:", nomatchAudio);
      console.log("Noinput Audio:", noinputAudio);
      console.log(
        "ID:",
        id,
        "Menuname:",
        Menuname,
        "TexttoSay:",
        TexttoSay,
        "Channel:",
        Channel,
        "Menu options:",
        menuoptions
      );

      const results = await pgPool.query(
        "SELECT * FROM MenuNode WHERE id = $1",
        [id]
      );
      console.log("Results:", results.rows);

      if (results.rows.length > 0) {
        const updateQuery = `
          UPDATE MenuNode 
          SET Menuname = $1, TexttoSay = $2, Channel = $3, menuoption = $4, initialAudio = $5, nomatchAudio = $6, noinputAudio = $7
          WHERE id = $8`;

        await pgPool.query(updateQuery, [
          Menuname,
          TexttoSay,
          Channel,
          menuoptions,
          initialAudio,
          nomatchAudio,
          noinputAudio,
          id,
        ]);
        console.log("Menu node updated successfully");
      } else {
        const insertQuery = `
          INSERT INTO MenuNode (id, Menuname, TexttoSay, Channel, menuoption, initialAudio, nomatchAudio, noinputAudio) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

        await pgPool.query(insertQuery, [
          id,
          Menuname,
          TexttoSay,
          Channel,
          menuoptions,
          initialAudio,
          nomatchAudio,
          noinputAudio,
        ]);

        console.log("Menu node saved successfully");
      }

      // Save the audio files to the FreeSWITCH server
      if (initialAudio) {
        await saveAudioToFreeSWITCHServer(
          req.files.audioFile[0].originalname,
          initialAudio
        );
      }
      if (nomatchAudio) {
        await saveAudioToFreeSWITCHServer(
          req.files.nomatchAudioFile[0].originalname,
          nomatchAudio
        );
      }
      if (noinputAudio) {
        await saveAudioToFreeSWITCHServer(
          req.files.noinputAudioFile[0].originalname,
          noinputAudio
        );
      }

      return res.status(200).json({ message: "Menu node saved successfully" });
    } catch (err) {
      console.error("Error handling menu node:", err);
      return res.status(500).json({ error: "Failed to handle menu node" });
    }
  }
);

async function saveAudioToFreeSWITCHServer(fileName, fileBuffer) {
  const sftp = new SftpClient();
  const remotePath = `/usr/local/freeswitch/sounds/en/us/callie/${fileName}`;

  let buffer;
  if (Buffer.isBuffer(fileBuffer)) {
    buffer = fileBuffer;
  } else if (fileBuffer instanceof ArrayBuffer) {
    buffer = Buffer.from(new Uint8Array(fileBuffer));
  } else if (Array.isArray(fileBuffer)) {
    buffer = Buffer.from(fileBuffer);
  } else if (typeof fileBuffer === "object" && fileBuffer.data) {
    buffer = Buffer.from(fileBuffer.data);
  } else {
    console.error(
      "Unsupported fileBuffer type:",
      typeof fileBuffer,
      fileBuffer
    );
    throw new Error("Unsupported fileBuffer type");
  }

  try {
    await sftp.connect({
      host: "10.16.7.80",
      port: 22,
      username: "cust",
      password: "Zeniusit@123",
    });

    await sftp.put(buffer, remotePath);
    console.log(`Audio file ${fileName} saved to FreeSWITCH server`);
  } catch (err) {
    console.error("Error saving audio to FreeSWITCH server:", err);
  } finally {
    sftp.end();
  }
}

app.post("/retrieve_flow_data", async (req, res) => {
  try {
    const query = "SELECT flowdata FROM Zconnectflow WHERE flowName = $1";
    const values = [req.body.flowName];

    const data = await pgPool.query(query, values);
    if (data.rows.length > 0) {
      const flowdata = data.rows[0].flowdata.toString();
      // console.log("Flow data from the data base :: ", flowdata);
      res.json(flowdata);
      return flowdata;
    } else {
      console.log("No flow data found for the given flow name");
      res.json({});
      return null;
    }
  } catch (err) {
    console.error("Error retrieving flow data:", err);
    throw err;
  }
});

app.put("/save-flow", async (req, res) => {
  const { flowName, lastData } = req.body;
  console.log("Request body ::", req.body);

  const lastDataFiltered = lastData.filter((data) => !data.hasOwnProperty('NodesData'));

  const generatedJSCode = generateJSCode(lastDataFiltered);
  console.log("Generated JS Code :: ", generatedJSCode);

  try {
    if (typeof generatedJSCode == "string") {
      if (flowName === "") {
        console.log("The flow name is empty");
        res.status(500).json({ error: "Failed to save JavaScript code" });
      } else {
        const client = await pgPool.connect();
        const query = "SELECT flowdata FROM Zconnectflow WHERE flowName = $1";
        const values = [
          flowName
        ];
        const flowLength = await client.query(query, values);
        const query1 = flowLength.rows.length > 0 ?
          "UPDATE Zconnectflow SET jsCode=$2,flowdata=$3 WHERE flowName=$1 RETURNING id"
          :
          "INSERT INTO Zconnectflow (flowName, jsCode,flowdata) VALUES ($1, $2,$3) RETURNING id";
        const values1 = [
          flowName,
          Buffer.from(generatedJSCode, "utf-8"),

          Buffer.from(JSON.stringify(lastData)),
        ];
        console.log("Values", values);

        const result = await client.query(query1, values1);
        client.release();
        console.log("Result ::", result);

        if (result.rows.length > 0) {
          const newId = result.rows[0].id;
          res.status(200).json({
            message: "JavaScript code saved successfully",
            id: newId,
            content: generatedJSCode,
          });
        } else {
          res.status(500).json({ error: "Failed to save JavaScript code" });
        }
      }
    } else {
      res.status(400).json({
        error: ` Please configure the ${generatedJSCode.prevNode} node correctly`,
      });
    }
  } catch (error) {
    console.error("Error saving JavaScript code:", error);
    res.status(500).json({ error: "Failed to save JavaScript code" });
  }
});

app.post("/check-flow-name", async (req, res) => {
  const { flowName } = req.body;
  console.log("Checking flow name:", flowName);

  try {
    const client = await pgPool.connect();
    const query = "SELECT 1 FROM Zconnectflow WHERE flowName = $1";
    const values = [flowName];
    const result = await client.query(query, values);
    client.release();

    if (result.rows.length > 0) {
      res.status(200).json({ exists: true });
    } else {
      res.status(200).json({ exists: false });
    }
  } catch (error) {
    console.error("Error checking flow name:", error);
    res.status(500).json({ error: "Failed to check flow name" });
  }
});


app.get("/project_list", async (req, res) => {
  // const { flowName } = req.body;
  // console.log("Checking flow name:", flowName);

  try {
    const client = await pgPool.connect();
    const query = "SELECT flowname FROM Zconnectflow";
    // const values = [flowName];
    const result = await client.query(query);
    client.release();
    if (result.rows.length > 0) {
      console.log("flow names :: ", result.rows);
      res.send(result.rows)
    } else {
      res.status(200).json({ exists: false });
    }
  } catch (error) {
    console.error("Error checking flow name:", error);
    res.status(500).json({ error: "Failed to check flow name" });
  }
});

app.post("/deploy", async (req, res) => {
  const { flowName } = req.body;
  console.log("Request body :: ", req.body);
  console.log("Deploying flow with name:", flowName);

  try {
    if (flowName === "") {
      console.log("The flow name is empty ");
      res.status(500).json({ message: "Failed to deploy flow" });
    } else {
      const result = await pgPool.query(
        "SELECT jscode FROM Zconnectflow WHERE flowname = $1",
        [flowName]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Flow not found" });
      }

      console.log("Retrieved flow from the database");

      const jsCodeBuffer = result.rows[0].jscode;

      const conn = new Client();
      conn
        .on("ready", () => {
          console.log("Client :: ready");
          conn.sftp((err, sftp) => {
            if (err) throw err;

            const remotePath = `/etc/zconnectivr/scripts/${flowName}.js`;
            console.log("Remote path ::", remotePath);
            sftp.writeFile(remotePath, jsCodeBuffer, (err) => {
              if (err) {
                console.error("SFTP error:", err);
                res
                  .status(500)
                  .json({ message: "Failed to upload file via SFTP" });
              } else {
                console.log("File uploaded successfully");

                const xmlPath = "/etc/zconnectivr/dialplan/default.xml";
                sftp.readFile(xmlPath, "utf8", (err, data) => {
                  console.log("Data in 138 line ::", data);
                  let updatedXml;
                  if (err && err.code === "ENOENT") {
                    console.log(
                      "Dialplan XML does not exist. Creating new file."
                    );
                    updatedXml = `
    <include>
        <extension name="${flowName}">
        </extension>
    </include>`;
                  } else if (err) {
                    console.error("Error reading XML file:", err);
                    return res
                      .status(500)
                      .json({ message: "Failed to read dialplan XML" });
                  } else {
                    const newExtension = `\n<extension name="${flowName}">\n</extension>\n`;
                    if (data.includes("</include>")) {
                      updatedXml = data.replace(
                        "\n</include>",
                        `${newExtension}</include>\n`
                      );
                    } else {
                      updatedXml =
                        data + `<include>\n${newExtension}</include>\n`;
                    }
                  }

                  sftp.writeFile(xmlPath, updatedXml, "utf8", (err) => {
                    if (err) {
                      console.error("Error writing XML file:", err);
                      res
                        .status(500)
                        .json({ message: "Failed to update dialplan XML" });
                    } else {
                      console.log("Dialplan XML updated successfully");
                      res.status(200).json({
                        message:
                          "Flow deployed and dialplan XML updated successfully",
                      });
                    }
                    conn.end();
                  });
                });
              }
            });
          });
        })
        .connect({
          host: "10.16.7.80",
          port: 22,
          username: "cust",
          password: "Zeniusit@123",
        });
    }
  } catch (error) {
    console.error("Error deploying flow:", error);
    res.status(500).json({ message: "Failed to deploy flow" });
  }
});

const retrieveCode = async (flowName) => {
  try {
    const query = "SELECT jsCode FROM Zconnectflow WHERE flowName = $1";
    const values = [flowName];

    const res = await pgPool.query(query, values);
    if (res.rows.length > 0) {
      const jsCode = res.rows[0].jscode.toString("utf-8");
      console.log("JavaScript Code which retrived from PostgreSQL", jsCode);
      return jsCode;
    } else {
      console.log("No code found for the given flow name");
      return null;
    }
  } catch (err) {
    console.error("Error retrieving code:", err);
    throw err;
  }
};

retrieveCode("kimfather");

function generateJSCode(ivrNodes) {
  var invalidStatus;
  var prevNode;
  var jsCode = `var languageCode = "en/us/callie";
    var soundDir = "/usr/local/freeswitch/sounds/";
 
    function playFile(fileName, callBack, callBackArgs)
    {
      session.streamFile(soundDir + languageCode + "/" + fileName, callBack, callBackArgs);
    }
 
    session.answer();
 
    session.execute("set", "tts_engine=flite");
    session.execute("set", "tts_voice=slt");
    session.execute("set", "flite_rate=0.2");
    var values = {};
`;

  function findNodeByLabel(label) {
    return ivrNodes.find((node) => node.sourceLabel === label);
  }

  function processNode(node) {
    console.log("node", node);
    if (!node || node === "undefined") {
      invalidStatus = {
        status: 500,
        prevNode: prevNode,
      };
    } else {
      var nodeType = node.nodeType;
      if (nodeType === "Play Prompt") {
        console.log("prevNode in audio :: ", prevNode);
        console.log("target in audio :: ", node.target);
        if (!node.hasOwnProperty("popupDetails") || !node.target) {
          invalidStatus = {
            status: 500,
            prevNode: prevNode
          };
        } else {
          console.log("else in audio");

          prevNode = node.target;
          var audioFile = node.popupDetails?.initialAudio?.Audioname;
          var TexttoSay = node.popupDetails?.TexttoSay;
          jsCode += audioFile
            ? `playFile("${audioFile}");\n`
            : `session.execute("speak", "${TexttoSay}");\n`;
          var targetLabel = node.target;
          var targetNode = findNodeByLabel(targetLabel);
          processNode(targetNode);
        }
      } else if (nodeType === "Menu") {
        if (
          !node.hasOwnProperty("popupDetails") ||
          !node.hasOwnProperty("optionsTarget") ||
          !node.popupDetails.menuoptions.length > 2
        ) {
          invalidStatus = {
            status: 500,
            prevNode: prevNode,
          };
        } else {
          var id = 0;
          id++;
          console.log("else in menu");
          var initialAudio = node.popupDetails?.initialAudio?.Audioname;
          var TexttoSay = node.popupDetails?.TexttoSay;
          var NomatchAudio = node.popupDetails.NomatchAudio?.NomatchAudioName;
          var NoinputAudio = node.popupDetails.NoinputAudio?.NomatchAudioName;
          var maxTries = node.popupDetails?.Maxtries;
          const ValidOptions = Array.from(
            { length: node.popupDetails.menuoptions },
            (_, index) => `"${index + 1}"`
          );
          jsCode += `values["validDigits${id}"] = [${ValidOptions}]
          values["retryCount${id}"]=0;
          values["NoInput${id}"]=0;
          values["NoMatch${id}"]=0;
                      while (values["retryCount${id}"] < ${maxTries}) {\n`;
          jsCode += initialAudio
            ? `playFile("${initialAudio}");\n`
            : `session.execute("speak", "${TexttoSay}");
values["digits${id}"] = session.getDigits(1, "", 3000);
if (values["digits${id}"] == "") {`;
          jsCode += NoinputAudio
            ? `playFile("${NoinputAudio}");\n`
            : `session.execute("speak", "${node.popupDetails.NoinputTTS}");
  values["retryCount${id}"]++;
  values["NoInput${id}"]++;
} else if (!values["validDigits${id}"].includes(values["digits${id}"])) {`;
          jsCode += NomatchAudio
            ? `playFile("${NomatchAudio}");\n`
            : `session.execute("speak", "${node.popupDetails.NomatchTTS}");
  values["retryCount${id}"]++;
  values["NoMatch${id}"]++;
} else {
  switch (values["digits${id}"]) {`;
          var menuOptions = node.popupDetails.menuoptions;
          for (let i = 0; i < menuOptions; i++) {
            prevNode =
              Object.values(node.optionsTarget)[i] !== undefined
                ? Object.values(node.optionsTarget)[i]
                : node.sourceLabel;
            console.log("prevnode :: ", prevNode);
            jsCode += `    case "${i + 1}":\n`;
            var targetLabel = Object.values(node.optionsTarget)[i];
            console.log("targetLabel : ", targetLabel);
            var targetNode = findNodeByLabel(targetLabel);
            processNode(targetNode);
            jsCode += `break;\n`;
          }
          jsCode += `}\n}\n}
      if (values["retryCount${id}"] === ${maxTries} && values["NoInput${id}"] === ${maxTries}) {
      session.execute("speak", "${node.popupDetails.MaxTriesTTS}");\n`;
          processNode(findNodeByLabel(node.optionsTarget.NI));
          jsCode += `} else if (values["retryCount${id}"] === ${maxTries} && values["NoMatch${id}"] > 1) {
              session.execute("speak", "${node.popupDetails.MaxTriesTTS}");\n`;
          processNode(findNodeByLabel(node.optionsTarget.NM));
          jsCode += ` } `;
        }
      } else if (nodeType === "Decision") {
        if (
          !node.hasOwnProperty("popupDetails") ||
          !node.hasOwnProperty("decisionTarget") ||
          Object.keys(node.decisionTarget).length !== 2
        ) {
          invalidStatus = {
            status: 500,
            prevNode: prevNode,
          };
        } else {
          var id = 0;
          id++;
          prevNode = node.sourceLabel;
          const { Operation: condition } = node.popupDetails;
          const sessionValue = node.popupDetails.Value.includes(".")
            ? node.popupDetails.Value
            : `"${node.popupDetails.Value}"`;
          const SessionKey = node.popupDetails.SessionKey.includes(".")
            ? node.popupDetails.SessionKey
            : `"${node.popupDetails.SessionKey}"`;
          const decisionTarget = node.decisionTarget;
          jsCode += `values["value${id}"] = session.getVariable(${SessionKey})\n`;
          switch (condition) {
            case "Equal to":
              jsCode += ` if (values["value${id}"] && values["value${id}"] ===${sessionValue}) {`;
              processNode(findNodeByLabel(decisionTarget["Yes"]));
              jsCode += `} else {\n`;
              processNode(findNodeByLabel(decisionTarget["No"]));
              jsCode += `}\n`;
              break;
            case "Greater than":
              jsCode += `if (values["value${id}"] && Number(values["value${id}"]) > Number(${sessionValue})) {\n`;
              processNode(findNodeByLabel(decisionTarget["Yes"]));
              jsCode += `} else {\n`;
              processNode(findNodeByLabel(decisionTarget["No"]));
              jsCode += `}\n`;
              break;
            case "Less than":
              jsCode += `if (values["value${id}"] && Number(values["value${id}"]) < Number(${sessionValue})) {\n`;
              processNode(findNodeByLabel(decisionTarget["Yes"]));
              jsCode += `} else {\n`;
              processNode(findNodeByLabel(decisionTarget["No"]));
              jsCode += `}\n`;
              break;
            case "Not equal to":
              jsCode += `if (values["value${id}"] && values["value${id}"] !== ${sessionValue}) {\n`;
              processNode(findNodeByLabel(decisionTarget["Yes"]));
              jsCode += `} else {\n`;
              processNode(findNodeByLabel(decisionTarget["No"]));
              jsCode += `}\n`;
              break;
            case "Greater than or equal to":
              jsCode += `if (values["value${id}"] && Number(values["value${id}"]) >= Number(${sessionValue})) {\n`;
              processNode(findNodeByLabel(decisionTarget["Yes"]));
              jsCode += `} else {\n`;
              processNode(findNodeByLabel(decisionTarget["No"]));
              jsCode += `}\n`;
              break;
            case "Less than or equal to":
              jsCode += `if (values["value${id}"] && Number(values["value${id}"]) <= Number(${sessionValue})) {\n`;
              processNode(findNodeByLabel(decisionTarget["Yes"]));
              jsCode += `} else {\n`;
              processNode(findNodeByLabel(decisionTarget["No"]));
              jsCode += `}\n`;
              break;
            default:
              processNode(findNodeByLabel(decisionTarget["No"]));
              jsCode += `}\n`;
          }
        }
      } else if (nodeType === "Session Variable") {
        if (!node.hasOwnProperty("popupDetails")) {
          invalidStatus = {
            status: 500,
            prevNode: prevNode,
          };
        } else {
          var id = 0;
          id++;
          prevNode = node.sourceLabel;
          const { Operation: condition } = node.popupDetails;
          const sessionKey = node.popupDetails.SessionData.includes(".")
            ? node.popupDetails.SessionData
            : `"${node.popupDetails.SessionData}"`;
          const startIndex = node.popupDetails?.StartIndex;
          const endIndex = node.popupDetails?.EndIndex;
          const Assign = node.popupDetails.Assign.includes(".")
            ? node.popupDetails.Assign
            : `"${node.popupDetails.Assign}"`;
          const Concat = node.popupDetails.Concat.includes(".")
            ? node.popupDetails.Concat
            : `"${node.popupDetails.Concat}"`;
          jsCode += `values["value${id}"] = session.getVariable(${sessionKey})\n`;
          switch (condition) {
            case "assign":
              if (Assign) {
                jsCode += `session.setVariable(${sessionKey}, ${Assign})\n`;
              }
              processNode(findNodeByLabel(node.target));
              break;
            case "slice":
              if (startIndex && endIndex) {
                jsCode += `if(values["value${id}"]){
                            session.setVariable(${sessionKey}, values["value${id}"].slice(${startIndex}, ${endIndex}))
                        }\n`;
              }
              processNode(findNodeByLabel(node.target));
              break;
            case "substr":
              if (startIndex && endIndex) {
                jsCode += `if(values["value${id}"]){
                                session.setVariable(${sessionKey}, values["value${id}"].substr(${startIndex}, ${endIndex}))
                            }\n`;
              }
              processNode(findNodeByLabel(node.target));
              break;
            case "replace":
              if (startIndex && endIndex) {
                jsCode += `if(values["value${id}"]){
                                session.setVariable(${sessionKey}, values["value${id}"].replace(${startIndex}, ${endIndex}))
                            }\n`;
              }
              processNode(findNodeByLabel(node.target));
              break;
            case "toUpperCase":
              jsCode += `if(values["value${id}"]){
                            session.setVariable(${sessionKey}, (values["value${id}"]).toUpperCase())
                        }\n`;
              processNode(findNodeByLabel(node.target));
              break;
            case "toLowerCase":
              jsCode += `if(values["value${id}"]){
                            session.setVariable(${sessionKey}, (values["value${id}"]).toLowerCase())
                        }\n`;
              processNode(findNodeByLabel(node.target));
              break;
            case "concat":
              if (Concat) {
                jsCode += `session.setVariable(${sessionKey}, values["value${id}"] + ${Concat})\n`;
              }
              processNode(findNodeByLabel(node.target));
              break;
            default:
              processNode(findNodeByLabel(node.target));
          }
        }
      } else if (nodeType === "Webhook") {
        if (!node.hasOwnProperty("popupDetails")) {
          invalidStatus = {
            status: 500,
            prevNode: prevNode,
          };
        } else {
          var id = 0;
          id++;
          prevNode = node.sourceLabel;
          const reqBody = node.popupDetails.HTTPMethod === 'POST' ? JSON.stringify(node.popupDetails.RequestBody) : JSON.stringify({});
          jsCode += `var ${node.popupDetails.apiResponse};
              function callback${id}(string, arg){
                  ${node.popupDetails.VariabletoSetResponse}=JSON.parse(string);
                  console_log("info","callback info "+ string+" args : "+arg);\n`;
          processNode(findNodeByLabel(node.target));
          jsCode += `return true;
              }
              curl.run("${node.popupDetails.HTTPMethod}", "${node.popupDetails.url}",${reqBody}, callback${id}, "my arg",5000,"content-type:application/json");\n`;
        }
      } else if (nodeType === "Exit") {
        if (!node.hasOwnProperty("popupDetails") || !node.target) {
          invalidStatus = {
            status: 500,
            prevNode: prevNode
          };
        } else {
          prevNode = node.target;
          var targetNode = findNodeByLabel(node.target);
          processNode(targetNode);
        }
      } else if (nodeType === "Entry") {
        if (!node.target) {
          invalidStatus = {
            status: 500,
            prevNode: prevNode
          };
        } else {
          prevNode = node.target;
          var targetNode = findNodeByLabel(node.target);
          processNode(targetNode);
        }
      } else if (nodeType === "Disconnect") {
        jsCode += `session.hangup();\n`;
      }
    }
  }

  var startNode = ivrNodes.find((node) => node.nodeType === "Start");
  var HangupNode = ivrNodes.find((node) => node.nodeType === "Disconnect");
  if (startNode && HangupNode) {
    console.log("Inside start and hangup node");
    prevNode = startNode.target;
    var targetNode = findNodeByLabel(startNode.target);
    console.log("Target node inside start hangup node", targetNode);
    if (targetNode) {
      processNode(targetNode);
    } else {
      invalidStatus = {
        status: 500,
        prevNode:
          prevNode !== undefined ? prevNode : HangupNode ? "Start" : "Disconnect",
      };
    }
  } else {
    invalidStatus = {
      status: 500,
      prevNode:
        prevNode !== undefined ? prevNode : HangupNode ? "Start" : "Disconnect",
    };
  }
  return invalidStatus ? invalidStatus : jsCode;
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
