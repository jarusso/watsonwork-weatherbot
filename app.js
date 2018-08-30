/*eslint-env node, express*/

// This application uses express as its web server
// for more info, see: http://expressjs.com
var express = require("express");
var request = require("request");
var crypto = require("crypto");

var APP_ID = process.env.APP_ID;
var APP_SECRET = process.env.APP_SECRET;
var WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const WWS_URL = "https://api.watsonwork.ibm.com";
const AUTHORIZATION_API = "/oauth/token";
var WEBHOOK_VERIFICATION_TOKEN_HEADER = "X-OUTBOUND-TOKEN".toLowerCase();

// create a new express server
var app = express();

// serve the files out of ./public as our main files
app.use(express.static(__dirname + "/public"));

function rawBody(req, res, next) {
    var buffers = [];
    req.on("data", function(chunk) {
        buffers.push(chunk);
    });
    req.on("end", function() {
        req.rawBody = Buffer.concat(buffers);
        next();
    });
}

function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }
    res.status(500);
    res.render("error", {
        error: err
    });
}

app.use(rawBody);
app.use(errorHandler);

app.listen(process.env.PORT || 3000, () => {
  console.log("INFO: app is listening on port: " + (process.env.PORT || 3000));
});

app.post("/weatherbot", function(req, res) {

  if (!APP_ID || !APP_SECRET || !WEBHOOK_SECRET) {
  	console.log("ERROR: Missing variables APP_ID, APP_SECRET or WEBHOOK_SECRET from environment");
  	return;
  }

  if (!verifySender(req.headers, req.rawBody)) {
      console.log("ERROR: Cannot verify caller! -------------");
      console.log(req.rawBody.toString());
      res.status(200).end();
      return;
  }

  var body = JSON.parse(req.rawBody.toString());
  var eventType = body.type;
  if (eventType === "verification") {
      handleVerificationRequest(res, body.challenge);
      console.log("INFO: Verification request processed");
      return;
  }

  // Acknowledge we received and processed notification to avoid getting sent the same event again
  res.status(200).end();


  if (eventType !== "message-annotation-added") {
    console.log("INFO: Skipping unwanted eventType: " + eventType);
    return;
  }

  if (body.userId === APP_ID) {
    console.log("INFO: Skipping our own message Body: " + JSON.stringify(body));
    return;
  }

  const spaceId = body.spaceId;

  var msgTitle = "";
  var msgText = "";
  var memberName = "";
  var memberId = "";

  const annotationType = body.annotationType;
  var messageId = body.messageId;
  var annotationPayload = JSON.parse(body.annotationPayload);

  msgTitle = "Annotation is ===";
  msgText = annotationType;

  var operationWeather = "no weather";
  var doWeather = false;
  var fetchOperation = "none";
  
  
  var actionId = annotationPayload.actionId;
  if (annotationType === "actionSelected") {
    	if ( actionId === "GET_WEATHER")
    	{
    		operationWeather = "WEATHER";
    		doWeather = true;
    		fetchOperation = "get";
    	}
    	else if ( actionId === "GET_FORECAST")
    	{
    		operationWeather = "FORECAST";
    		doWeather = true;
    		fetchOperation = "get";
    	}
    	else if ( actionId === "SHARE_WEATHER")
    	{
    		operationWeather = "WEATHER";
    		doWeather = true;
    		fetchOperation = "share";
    	}
    	else if ( actionId === "SHARE_FORECAST")
    	{
    		operationWeather = "FORECAST";
    		doWeather = true;
    		fetchOperation = "share";
    	}
  }

  if (!doWeather)
  {
            return;
  }

  console.log("performing an operation: " + operationWeather + " operation type: " + fetchOperation);

  msgText = operationWeather + 	" " + msgText;

  var userId = "";
  var userName = "";
  var dialogId = "";
  var conversationId = "";

  userId = body.userId;
  userName = body.userName;
  dialogId = annotationPayload.targetDialogId;
  conversationId = annotationPayload.conversationId;
  actionId = annotationPayload.actionId;

  // Build request options for authentication.
  const authenticationOptions = {
    "method": "POST",
    "url": `${WWS_URL}${AUTHORIZATION_API}`,
    "auth": {
        "user": APP_ID,
        "pass": APP_SECRET
    },
    "form": {
        "grant_type": "client_credentials"
    }
  };

  request(authenticationOptions, function(err, response, authenticationBody) {

    // If successful authentication, a 200 response code is returned
    if (response.statusCode !== 200) {
        // if our app can't authenticate then it must have been disabled.  Just return
        console.log("ERROR: App can't authenticate");
        return;
    }
    const accessToken = JSON.parse(authenticationBody).access_token;

    const GraphQLOptions = {
        "url": `${WWS_URL}/graphql`,
        "headers": {
            "Content-Type": "application/graphql",
            "x-graphql-view": "PUBLIC, BETA",
            "jwt": "${jwt}"
        },
        "method": "POST",
        "body": ""
    };


    if ( fetchOperation === "get")
    {
        createCard ( accessToken, conversationId, userId, dialogId, operationWeather);
    }
    else if (( fetchOperation === "share") && ( operationWeather === "WEATHER"))
    {
        msgTitle = "Current Weather";

        var weather = {
            "method": "POST",
            "url": "http://api.apixu.com/v1/current.json?key=ac3602719a174e24a3c200054182806&q=Boston"
        };



        // post weather
        var weatherBody = "";
        request(weather, function(err, response, weatherBody) {

            if (!err && response.statusCode === 200) {
                  var weatherParsed = JSON.parse(weatherBody);
                  msgText = "Temp is " + weatherParsed.current.temp_f + " " + weatherParsed.current.condition.text + " humidity is " + weatherParsed.current.humidity + " feels like " + weatherParsed.current.feelslike_f;
                  processWeather (spaceId, accessToken, msgTitle, msgText);
                  clearCard( accessToken, conversationId, userId, dialogId );
            } else {
                return;
            }});
    }
    else if (( fetchOperation === "share") && ( operationWeather === "FORECAST"))
    {
        msgTitle = "Current Forecast";
        var weather = {
            "method": "POST",
            "url": "http://api.apixu.com/v1/forecast.json?key=ac3602719a174e24a3c200054182806&q=Boston&days=5"
        };
        var weatherBody = "";


        request(weather, function(err, response, weatherBody) {

            if (!err && response.statusCode === 200) {
                  var weatherParsed = JSON.parse(weatherBody);
                  msgText = "";
                  for (i = 0; i < 5; i++)
                  {
                      msgText += " High " + weatherParsed.forecast.forecastday[i].day.maxtemp_f;
                      msgText += " Low " + weatherParsed.forecast.forecastday[i].day.mintemp_f;
                      msgText += "  " + weatherParsed.forecast.forecastday[i].day.condition.text;
                      if ( i < 4)
                        msgText += " \n " ;
                  }
                  processWeather (spaceId, accessToken, msgTitle, msgText);
                  clearCard( accessToken, conversationId, userId, dialogId );
            } else {
                return;
            }});

    }
    });
  });
  
function createCard ( accessToken, conversationId, userId, dialogId, operationWeather)
{
    const createGraphQLOptions = {
        "url": `${WWS_URL}/graphql`,
        "headers": {
            "Content-Type": "application/graphql",
            "x-graphql-view": "PUBLIC, BETA",
            "jwt": "${jwt}"
        },
        "method": "POST",
        "body": ""
    };
        createGraphQLOptions.headers.jwt = accessToken;

        createGraphQLOptions.body = 'mutation {';
        createGraphQLOptions.body += 'createTargetedMessage(input: {';
        createGraphQLOptions.body += 'conversationId: "' + conversationId + '",';
        createGraphQLOptions.body += 'targetUserId: "' + userId + '",';
        createGraphQLOptions.body += 'targetDialogId: "' + dialogId + '",';
        createGraphQLOptions.body += 'attachments: [';
        createGraphQLOptions.body += '{';
        createGraphQLOptions.body += 'type: CARD,';
        createGraphQLOptions.body += 'cardInput: {';
        createGraphQLOptions.body += 'type: INFORMATION,';
        createGraphQLOptions.body += 'informationCardInput: {'
        createGraphQLOptions.body += 'title: "' + operationWeather + '",';
        createGraphQLOptions.body += 'subtitle: "",';
        createGraphQLOptions.body += 'text: "' + operationWeather + '",';
        createGraphQLOptions.body += 'date: 1500573338000,';
        createGraphQLOptions.body += 'buttons: [';
        createGraphQLOptions.body += '{';
        createGraphQLOptions.body += 'text: "Share the ' + operationWeather.toLowerCase() + '",';
        createGraphQLOptions.body += 'payload: "SHARE_' + operationWeather + '",';
        createGraphQLOptions.body += 'style: PRIMARY';
        createGraphQLOptions.body += '}';
        createGraphQLOptions.body += ']';
        createGraphQLOptions.body += '}';
        createGraphQLOptions.body += '}';
        createGraphQLOptions.body += '}';
        createGraphQLOptions.body += ']';
        createGraphQLOptions.body += '}) {';
        createGraphQLOptions.body += 'successful';
        createGraphQLOptions.body += '}';
        createGraphQLOptions.body += '};';

        request(createGraphQLOptions, function(err, response, graphqlbody) {


        if (!err && response.statusCode === 200) {
          const bodyParsed = JSON.parse(graphqlbody);

        } else {
          console.log("ERROR: Can't retrieve " + createGraphQLOptions.body + " status:" + response.statusCode);
          return;
        }});
    
}


function clearCard( accessToken, conversationId, userId, dialogId) {
    // graphQL object
    const localGraphQLOptions = {
        "url": `${WWS_URL}/graphql`,
        "headers": {
            "Content-Type": "application/graphql",
            "x-graphql-view": "PUBLIC, BETA",
            "jwt": "${jwt}"
        },
        "method": "POST",
        "body": ""
    };
    localGraphQLOptions.headers.jwt = accessToken;

    localGraphQLOptions.body = 'mutation {';
    localGraphQLOptions.body += 'createTargetedMessage(input: {';
    localGraphQLOptions.body += 'conversationId: "' + conversationId + '",';
    localGraphQLOptions.body += 'targetUserId: "' + userId + '",';
    localGraphQLOptions.body += 'targetDialogId: "' + dialogId + '",';
    localGraphQLOptions.body += 'annotations: [';
    localGraphQLOptions.body += '{';
    localGraphQLOptions.body += 'genericAnnotation: {'
    localGraphQLOptions.body += 'title: "Weather shared. Please click X to close this panel.",';
    localGraphQLOptions.body += 'text: ""';
    localGraphQLOptions.body += '}}';
    localGraphQLOptions.body += ']';
    localGraphQLOptions.body += '}) {';
    localGraphQLOptions.body += 'successful';
    localGraphQLOptions.body += '}';
    localGraphQLOptions.body += '};';


    request(localGraphQLOptions, function(err, response, graphqlbody) {


        if (!err && response.statusCode === 200) {
          const bodyParsed = JSON.parse(graphqlbody);

        } else {
          console.log("ERROR: Can't retrieve " + localGraphQLOptions.body + " status:" + response.statusCode);
          return;
        }});

}



function processWeather(spaceId, accessToken, msgTitle, msgText) {
    const appMessage = {
            "type": "appMessage",
            "version": "1",
            "annotations": [{
                "type": "generic",
                "version": "1",

                "title": "",
                "text": "",
                "color": "#ececec",
            }]
        };

        const sendMessageOptions = {
                "url": "https://api.watsonwork.ibm.com/v1/spaces/${space_id}/messages",
                "headers": {
                    "Content-Type": "application/json",
                    "jwt": ""
                },
                "method": "POST",
                "body": ""
            };

            sendMessageOptions.url = sendMessageOptions.url.replace("${space_id}", spaceId);
            sendMessageOptions.headers.jwt = accessToken;
            appMessage.annotations[0].title = msgTitle;
            appMessage.annotations[0].text = msgText;
            sendMessageOptions.body = JSON.stringify(appMessage);

            request(sendMessageOptions, function(err, response, sendMessageBody) {

              if (err || response.statusCode !== 201) {
                  console.log("ERROR: Posting to " + sendMessageOptions.url + "resulted on http status code: " + response.statusCode + " and error " + err);
              }

            });

}

function verifySender(headers, rawbody) {
    var headerToken = headers[WEBHOOK_VERIFICATION_TOKEN_HEADER];
    var endpointSecret = WEBHOOK_SECRET;
    var expectedToken = crypto
        .createHmac("sha256", endpointSecret)
        .update(rawbody)
        .digest("hex");

    if (expectedToken === headerToken) {
        return Boolean(true);
    } else {
        return Boolean(false);
    }
}

function handleVerificationRequest(response, challenge) {
    var responseBodyObject = {
        "response": challenge
    };
    var responseBodyString = JSON.stringify(responseBodyObject);
    var endpointSecret = WEBHOOK_SECRET;

    var responseToken = crypto
        .createHmac("sha256", endpointSecret)
        .update(responseBodyString)
        .digest("hex");

    response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "X-OUTBOUND-TOKEN": responseToken
    });

    response.end(responseBodyString);
}
