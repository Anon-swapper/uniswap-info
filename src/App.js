import React, { Component } from "react";

import "react-table/react-table.css";

import { defaults } from "react-chartjs-2";

import { Bar } from "react-chartjs-2";

import { BigNumber } from "bignumber.js";

import TokenPoolDetails from "./components/TokenPoolDetails";
import TokenPoolHistory from "./components/TokenPoolHistory";
import AccountVolumes from "./components/AccountVolumes";
import TokenDropdown from "./components/TokenDropdown";
import Header from "./components/Header";
import Container, { Grid } from "./components/Container";
import Attribution from "./components/Attribution";

import Uniswap from "./constants/Uniswap.js";

import { useWeb3Context } from "web3-react/hooks";

import "typeface-inter";
import "./App.css";

var app;

var web3 = null;

var didRequestData = false;
var didReceiveData = false;

var eventList = [];
var accountVolumesList = [];

var volumeDataMap = {}; // how much trading volume keyed by day

var ethLiquidityDataMap = {}; // how much liquidity in pool keyed by day (eth)
var tokenLiquidityDataMap = {}; // how much liquidity in pool keyed by day (token)

var curSymbol = "";

var curEthPoolTotal = "-";
var curTokenPoolTotal = "-";
var curPoolShare = "-";
var avgDepRate = "-";

var myCollectedEthFees = "";
var myCollectedTokenFees = "";

var netCollectedTokenFees = "-";
var brutoCollectedTokenFees = "";

var aprDisplay = "-";

var myAddress = "";
var tokenAddress = "";
var tokenLoading = false;

var exchangeRate = 0;

var providerFeePercent = 0.003;

var accountVolume = {};

var oldEventsExchange = {};
var firstBlock = Uniswap.originBlock;

var totalVol = 0.0;

const oneDayOffset = 24 * 60 * 60 * 1000; // in milliseconds

const tokenOptions = [];

function GetEthToTokenPrice(ethReserve, tokenReserve) {
  var inputEthWithFee = 1 - providerFeePercent;
  var numerator = inputEthWithFee * tokenReserve;
  var denominator = ethReserve + inputEthWithFee;

  var rate = numerator / denominator;
  if (rate > 0) {
    return rate;
  } else {
    return 0;
  }
}

function changeBar(firstBlock, currentBlock, latestBlock) {
  var loadingBar = document.getElementById("loadingBar");
  let width = Math.round((currentBlock-firstBlock)/(latestBlock-firstBlock)*100);
  // console.log(width);
  loadingBar.style.width = width + '%';
}

class App extends Component {
  constructor(props) {
    super(props);

    app = this;

    defaults.global.animation = false;
  }

  componentDidMount(props) {
    let exchangeAddress = Uniswap.tokens[curSymbol].address;

    retrieveData(curSymbol, exchangeAddress);
  }

  componentWillMount(props) {
    var symbol = Uniswap.initial;

    // check for URL Search Params support
    if ("URLSearchParams" in window) {
      // extract exchange token from URL if found
      var urlParams = new URLSearchParams(window.location.search);

      if (urlParams.has("token")) {
        symbol = urlParams.get("token");
      }
    }

    curSymbol = symbol;
    tokenAddress = "";

    for (var token in Uniswap.tokens) {
      tokenOptions.push({
        value: token,
        label: `${token} - ${Uniswap.tokens[token].address}`
      });
    }
  }

  onTokenSelected(option) {
    if (tokenLoading) {
      return
    }
    var symbol = option.value;

    console.log(symbol);

    curSymbol = symbol;
    tokenAddress = "";

    didRequestData = false;
    didReceiveData = false;

    eventList = [];

    volumeDataMap = {};

    ethLiquidityDataMap = {};
    tokenLiquidityDataMap = {};

    curEthPoolTotal = "-";
    curTokenPoolTotal = "-";
    curPoolShare = "-";
    avgDepRate = "-";

    myCollectedEthFees = "-";
    myCollectedTokenFees = "-";

    netCollectedTokenFees = "-";
    brutoCollectedTokenFees = "-";

    aprDisplay = "-";

    exchangeRate = 0;
    totalVol = 0.0;

    app.setState({});

    let exchangeAddress = Uniswap.tokens[curSymbol].address;

    retrieveData(curSymbol, exchangeAddress);
  }

  render() {
    var exchangeAddress = Uniswap.tokens[curSymbol].address;

    return (
      <Container>
        {/* @TODO: find better way to handle this */}
        <div hidden>
          <Web3Setter />
        </div>

        <Header>
          {/* @NOTE: Index 22 of tokenOptions is DAI */}
          <TokenDropdown
            options={tokenOptions}
            defaultValue={tokenOptions[22]}
            onChange={this.onTokenSelected}
          />
        </Header>

        <Grid>
          <div className="TokenDetails">
            <TokenPoolDetails
              curSymbol={curSymbol}
              exchangeRate={exchangeRate}
              tokenAddress={tokenAddress}
              curEthPoolTotal={curEthPoolTotal}
              curTokenPoolTotal={curTokenPoolTotal}
              curPoolShare={curPoolShare}
              avgDepRate={avgDepRate}
              myCollectedEthFees={myCollectedEthFees}
              myCollectedTokenFees={myCollectedTokenFees}
              netCollectedTokenFees={netCollectedTokenFees}
              brutoCollectedTokenFees={brutoCollectedTokenFees}
              aprDisplay={aprDisplay}
              exchangeAddress={exchangeAddress}
            />

            <TokenChart />
          </div>

          <div className="TokenHistory">
            <TokenPoolHistory
              eventList={eventList}
              curSymbol={curSymbol}
              myAddress={myAddress}
              didReceiveData={didReceiveData}
            />
          </div>

          <div className="accountVolumes">
            <AccountVolumes
              accountVolumesList={accountVolumesList}
              curSymbol={curSymbol}
              // myAddress={myAddress}
              didReceiveData={didReceiveData}
            />
          </div>

          <div className="Attribution">
            <Attribution />
          </div>
        </Grid>
      </Container>
    );
  }
}

const Web3Setter = props => {
  if (web3 === null) {
    web3 = useWeb3Context();
  }

  return <div />;
};

const TokenChart = props => {
  // don't render anything if we haven't loaded the events yet
  if (didReceiveData === false) {
    return <div />;
  }

  var labels = [];

  var volumeData = [];

  var ethLiquidityData = [];
  var tokenLiquidityData = [];
  var ethPriceData = [];

  var monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];

  // calculate dataset
  var numDaysBackToCalculate = 720;
  var numDaysToShowOnChart = 60;

  var currentEthLiquidity = 0;
  var currentTokenLiquidity = 0;

  for (var daysBack = numDaysBackToCalculate; daysBack >= 0; daysBack--) {
    var date = new Date(Date.now() - oneDayOffset * daysBack);

    var dateKey = date.getMonth() + "-" + date.getDate() + "-" + date.getFullYear();

    // track eth liquidity
    if (dateKey in ethLiquidityDataMap) {
      currentEthLiquidity += ethLiquidityDataMap[dateKey];
    }

    // track token liquidity
    if (dateKey in tokenLiquidityDataMap) {
      currentTokenLiquidity += tokenLiquidityDataMap[dateKey];
    }

    if (daysBack > numDaysToShowOnChart) {
      continue;
    }

    labels.push(
      monthNames[date.getMonth()] +
        " " +
        date.getDate()// +
        // ", " +
        // date.getFullYear()
    );

    if (dateKey in volumeDataMap) {
      volumeData.push(volumeDataMap[dateKey].toFixed(4));
    } else {
      volumeData.push(0);
    }

    ethLiquidityData.push(currentEthLiquidity.toFixed(4));

    tokenLiquidityData.push(currentTokenLiquidity.toFixed(4));

    // calculate the price of the token on this given day
    ethPriceData.push(GetEthToTokenPrice(currentEthLiquidity, currentTokenLiquidity).toFixed(4));
  }

  // don't even show liquidity points if there was no liquidity at all
  if (Object.keys(ethLiquidityDataMap).length === 0) {
    ethLiquidityData = [];
  }
  // don't even show liquidity points if there was no liquidity at all
  if (Object.keys(tokenLiquidityDataMap).length === 0) {
    tokenLiquidityData = [];
  }

  var tokenLiquidityLabel = "Liquidity (" + curSymbol + ")";

  const data = {
    datasets: [
      {
        label: "Liquidity (ETH)",
        type: "line",
        data: ethLiquidityData,

        lineTension: 0,

        borderColor: "rgba(251,167,27,1)",
        pointBorderColor: "rgba(251,167,27,1)",
        pointBackgroundColor: "rgba(251,167,27,1)",

        pointRadius: 1,
        pointHitRadius: 4,
        pointHoverRadius: 3,

        yAxisID: "y-axis-2"
      },
      {
        label: tokenLiquidityLabel,
        type: "line",
        data: tokenLiquidityData,

        lineTension: 0,

        borderColor: "rgba(87,183,87,1)",
        pointBorderColor: "rgba(87,183,87,1)",
        pointBackgroundColor: "rgba(87,183,87,1)",

        pointRadius: 1,
        pointHitRadius: 4,
        pointHoverRadius: 3,
        yAxisID: "y-axis-2"
      },
      {
        label: "Rate",
        type: "line",
        data: ethPriceData,

        lineTension: 0,

        borderColor: "rgba(243, 98, 45,1)",
        pointBorderColor: "rgba(243, 98, 45,1)",
        pointBackgroundColor: "rgba(243, 98, 45,1)",

        pointRadius: 1,
        pointHitRadius: 4,
        pointHoverRadius: 3,
        yAxisID: "y-axis-2"
      },
      {
        type: "bar",
        label: "Trade Volume (ETH)",
        data: volumeData,
        fill: false,
        backgroundColor: "rgba(160,160,160, 0.4)",

        hoverBackgroundColor: "rgba(231,82,232,0.4)",
        hoverBorderColor: "rgba(102,153,203,0.4)",

        yAxisID: "y-axis-1"
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    tooltips: {
      mode: "label"
    },
    elements: {
      line: {
        fill: false
      }
    },
    scales: {
      xAxes: [
        {
          display: true,
          gridLines: {
            display: false
          },
          labels: labels
        }
      ],
      yAxes: [
        {
          type: "linear",
          display: true,
          position: "left",
          id: "y-axis-1",
          gridLines: {
            display: false
          },
          labels: {
            show: true
          }
        },
        {
          type: "linear",
          display: true,
          position: "right",
          id: "y-axis-2",
          gridLines: {
            display: false
          },
          labels: {
            show: true
          }
        }
      ]
    }
  };

  return (
    <div className="TokenChart">
      <Bar
        data={data}
        // height={250}
        options={chartOptions}
      />
    </div>
  );
};

const retrieveData = (tokenSymbol, exchangeAddress) => {
  if (didRequestData) {
    return;
  }

  // get the token address
  var tokenDecimals = Math.pow(10, Uniswap.tokens[tokenSymbol].decimals);

  var exchangeContract = new web3.web3js.eth.Contract(
    Uniswap.abi,
    exchangeAddress
  );

  // fetch the token address
  tokenAddress = Uniswap.tokens[tokenSymbol].tokenAddress;

  didRequestData = true;

  console.log("Retrieving data for exchange=" + exchangeAddress);

  myAddress = web3.account;

  accountVolume = {};

  // topics
  // 0xcd60aa75dea3072fbc07ae6d7d856b5dc5f4eee88854f5b4abf7b680ef8bc50f = TokenPurchase
  // 0x06239653922ac7bea6aa2b19dc486b9361821d37712eb796adfd38d81de278ca = AddLiquidity
  // 0x7f4091b46c33e918a0f3aa42307641d17bb67029427a5369e54b353984238705 = EthPurchase
  // 0x0fbf06c058b90cb038a618f8c2acbf6145f8b3570fd1fa56abb8f0f3f05b36e8 = RemoveLiquidity

  let latestBlock = 0;

  let blockStep = 29999; // Number of blocks in each chunk

  if (!oldEventsExchange[exchangeAddress]){
    firstBlock = Uniswap.originBlock;
    let oldEvents = [];

    oldEventsExchange[exchangeAddress] = {"lastBlock": firstBlock, "events": oldEvents};
  }
  let blockNum = oldEventsExchange[exchangeAddress].lastBlock + 1;
  let oldEvents = oldEventsExchange[exchangeAddress].events;

  tokenLoading = true;

  async function getEvents() {
    latestBlock = await web3.web3js.eth.getBlockNumber();
    console.log("Latest block:" + latestBlock);

    try {
        while (blockNum < latestBlock ){
          //let loadingMessage = "Block number: " + blockNum + ", still " + Number(latestBlock-blockNum) + " blocks to go.";
          // document.getElementById("loadingPar").innerHTML = loadingMessage;
          changeBar(firstBlock, blockNum, latestBlock);
          // console.log(blockNum, latestBlock);
          let toBlock;

          if (blockNum + blockStep < latestBlock) {
            toBlock = blockNum + blockStep;
          } else {
            toBlock = latestBlock
          }

          let options = {
            address: exchangeAddress,
            fromBlock: blockNum,
            toBlock: toBlock
          };

          let events = await exchangeContract.getPastEvents("allEvents", options);

          oldEvents = oldEvents.concat(events);
          blockNum += blockStep + 1;
        }
        return oldEvents;     // this will be the resolved value of the returned promise
      } catch(e) {
        console.log(e);
        throw e;      // let caller know the promise was rejected with this reason
      }
  };

  getEvents().then(events => {
    tokenLoading = false;
    oldEventsExchange[exchangeAddress].lastBlock = latestBlock;
    oldEventsExchange[exchangeAddress].events = events;

    // only continue if the current exchange is the original symbol we requested
    if (curSymbol !== tokenSymbol) {
      return;
    }

    let eventListTemp = [];

    let curEthTotal = 0;
    let curTokenTotal = 0;

    curPoolShare = 0.0;
    avgDepRate = 0.0;

    let curPoolShareDisplay = 0.0;

    let numMyShareTokens = new BigNumber(0);
    let numMintedShareTokens = new BigNumber(0);

    let numMyDepositedEth = 0;
    let numMyDepositedTokens = 0;

    let earnedEthFee = 0.0;
    let earnedTokenFee = 0.0;

    let netFees = 0.0;

    // Date of the first liquidity added by an address
    let firstDepBlock = "";

    let lastEventObj;

    events.forEach(e => {
      let eventType = e.event;
      let ethFee = 0.0;
      let tokenFee = 0.0;

      let eventObj = {
        type: eventType,

        curPoolShare: 0.0,

        numEth: 0,
        numTokens: 0,

        id: e.id,

        tx: e.transactionHash,
        provider: e.returnValues.provider,
        block: e.blockNumber,
        time: "",

        liquidtyProviderFee: "-",

        volume: 0 // how much swapping volume was in this event (set by purchase events only)
      };

      let eth, tokens;

      if (eventType === "AddLiquidity") {
        eth = e.returnValues[1] / 1e18;
        tokens = e.returnValues.token_amount / tokenDecimals;

        eventObj.type = "Add Liquidty";

        if (eventObj.provider.toUpperCase() === myAddress.toUpperCase()) {
          numMyDepositedEth += eth;
          numMyDepositedTokens += tokens;

          // TODO Calculate the first date of deposit for an address
          if (!firstDepBlock) {
            firstDepBlock = eventObj.block;
          }
        }
      } else if (eventType === "RemoveLiquidity") {
        eth = -e.returnValues.eth_amount / 1e18;
        tokens = -e.returnValues.token_amount / tokenDecimals;

        eventObj.type = "Remove Liquidty";

        if (eventObj.provider.toUpperCase() === myAddress.toUpperCase()) {
          numMyDepositedEth += eth;
          numMyDepositedTokens += tokens;
        }
      } else if (eventType === "TokenPurchase" || eventType === "EthPurchase") {
        eventObj.provider = e.returnValues.buyer;

        // Create an empty object per account if it does not exist
        if (!accountVolume[eventObj.provider]){
          accountVolume[eventObj.provider] = {
            eth: 0.0,
            tokens: 0.0,
            numTx: 0
          }
        }

        accountVolume[eventObj.provider].numTx++;

        if (eventType === "TokenPurchase"){
          eth = e.returnValues.eth_sold / 1e18;
          tokens = -e.returnValues.tokens_bought / tokenDecimals;

          eventObj.type = "Token Purchase";

          eventObj.volume = eth;

          accountVolume[eventObj.provider].eth += eth;
          accountVolume[eventObj.provider].tokens += -tokens;

          // calculate the eth fee that liquidity providers will receive
          ethFee = eth * providerFeePercent;
          eventObj.liquidtyProviderFee = ethFee.toFixed(4) + " ETH";
        } else if (eventType === "EthPurchase") {
          eth = -e.returnValues.eth_bought / 1e18;
          tokens = e.returnValues.tokens_sold / tokenDecimals;

          eventObj.type = "Eth Purchase";

          eventObj.volume = -eth;

          accountVolume[eventObj.provider].eth += -eth;
          accountVolume[eventObj.provider].tokens += tokens;

          // calculate the token fee that liquidity providers will receive
          tokenFee = tokens * providerFeePercent;
          eventObj.liquidtyProviderFee = tokenFee.toFixed(4) + " " + tokenSymbol;
        }

        // add eth volume to total volume
        totalVol += eventObj.volume;
      } else if (eventType === "Transfer") {
        // Track share tokens
        let sender = e.returnValues[0];
        let receiver = e.returnValues[1];
        let numShareTokens = new BigNumber(e.returnValues[2]); // / 1e18;

        // check if this was mint or burn share tokens
        if (receiver === "0x0000000000000000000000000000000000000000") {
          // burn share tokens
          numMintedShareTokens = numMintedShareTokens.minus(numShareTokens);

          // check if the sender was user
          if (sender.toUpperCase() === myAddress.toUpperCase()) {
            numMyShareTokens = numMyShareTokens.minus(numShareTokens);
          }
        } else if (sender === "0x0000000000000000000000000000000000000000"){
          // mint share tokens
          numMintedShareTokens = numMintedShareTokens.plus(numShareTokens);

          if (receiver.toUpperCase() === myAddress.toUpperCase()) {
            numMyShareTokens = numMyShareTokens.plus(numShareTokens);
          }
        } else {
          console.log("Transfer of pool tokens in block: " + eventObj.block + ", hash: " + eventObj.tx);
        }

        // update current pool share. take users's share tokens and divide by total minted share tokens
        curPoolShare = new BigNumber(
          numMyShareTokens.dividedBy(numMintedShareTokens)
        );

        if (isNaN(curPoolShare) || curPoolShare.toFixed(4) === 0) {
          curPoolShare = 0;
          numMyDepositedEth = 0;
          numMyDepositedTokens = 0;
        }

        // get a percentage from the pool share
        curPoolShareDisplay = (curPoolShare * 100).toFixed(6);

        // if the user's pool share is 0, don't show a number
        if (Number(curPoolShareDisplay) === 0.0) {
          curPoolShareDisplay = "-";
        } else {
          curPoolShareDisplay = curPoolShareDisplay + "%"; // add a percentage symbol
        }

        // set it on the last event object before this transfer
        lastEventObj.curPoolShare = curPoolShareDisplay;

        return;
      }

      // Add new fees to total fees
      earnedEthFee += ethFee * curPoolShare;
      earnedTokenFee += tokenFee * curPoolShare;

      // save a reference to the last event object (transfer events follow add/remove liquidity)
      lastEventObj = eventObj;

      // update the total pool eth total
      curEthTotal += eth;

      // update the total pool token total
      curTokenTotal += tokens;

      // set the number of eth and tokens for this event
      eventObj.numEth = eth;
      eventObj.numTokens = tokens;

      // set the user's current pool share %
      eventObj.curPoolShare = curPoolShareDisplay;

      // push this event object onto the array
      eventListTemp.push(eventObj);
    });

    // reverse the list so the most recent events are first
    eventListTemp.reverse();

    // calculate how much fees we've accrued by determining how much eth/tokens we own minus what we've deposited/withdrawn
    let myEstimatedAccruedEthFees = (
      curPoolShare * curEthTotal -
      numMyDepositedEth
    )
    let myEstimatedAccruedTokenFees = (
      curPoolShare * curTokenTotal -
      numMyDepositedTokens
    )

    exchangeRate = GetEthToTokenPrice(curEthTotal, curTokenTotal);
    netFees = myEstimatedAccruedEthFees*exchangeRate + myEstimatedAccruedTokenFees;

    myEstimatedAccruedEthFees = myEstimatedAccruedEthFees.toFixed(2);
    myEstimatedAccruedTokenFees = myEstimatedAccruedTokenFees.toFixed(2);

    if (Number(myEstimatedAccruedEthFees) === 0) {
      myEstimatedAccruedEthFees = "";
    } else {
      myEstimatedAccruedEthFees = myEstimatedAccruedEthFees + " ETH";
    }

    if (Number(myEstimatedAccruedTokenFees) === 0) {
      myEstimatedAccruedTokenFees = "";
    } else {
      if (myEstimatedAccruedEthFees.length === 0) {
        myEstimatedAccruedTokenFees =
          myEstimatedAccruedTokenFees + " ";
      } else {
        myEstimatedAccruedTokenFees =
          ", " + myEstimatedAccruedTokenFees + " " + tokenSymbol;
      }
    }
    didReceiveData = true;

    eventList = eventListTemp;

    curEthPoolTotal = curEthTotal.toFixed(4);
    curTokenPoolTotal = curTokenTotal.toFixed(4);

    curPoolShare = curPoolShareDisplay;

    myCollectedEthFees = myEstimatedAccruedEthFees;
    myCollectedTokenFees = myEstimatedAccruedTokenFees;

    //Calculate average rate at which liquidity was put in
    let depRate = GetEthToTokenPrice(numMyDepositedEth, numMyDepositedTokens);
    avgDepRate = depRate.toFixed(2) + " " + tokenSymbol + " / ETH";

    //calculate the token value of the deposited liquidity
    let tokenValueDep = numMyDepositedEth*depRate + numMyDepositedTokens;

    netCollectedTokenFees = netFees.toFixed(2) + " " + tokenSymbol + ", ";
    netCollectedTokenFees += earnedEthFee.toFixed(2) + " ETH, ";
    netCollectedTokenFees += earnedTokenFee.toFixed(2) + " "+ tokenSymbol;

    // find the date with the first deposit block of the account
    web3.web3js.eth.getBlock(firstDepBlock).then(function(block) {
      //Timestamp of a block is in seconds
      let firstDepDate = new Date(block.timestamp*1000);
      let timeSinceDepDays = (new Date().getTime() - firstDepDate.getTime())/oneDayOffset;

      let apr = 365.0/timeSinceDepDays*100*netFees/tokenValueDep;

      aprDisplay = apr.toFixed(2) + "%";

      // Update state to include apr
      app.setState({});
    });

    // Sort account volumes from highest to lowest
    accountVolumesList = [];

    for (let account in accountVolume){
      accountVolumesList.push({
        "account": account,
        "eth": accountVolume[account].eth,
        "tokens": accountVolume[account].tokens,
        "numTx": accountVolume[account].numTx,
        "volPercentage": (accountVolume[account].eth/totalVol*100).toFixed(2) + "%"
      });
      //totalVol += accountVolume[account].eth;
    }

    accountVolumesList.sort((a, b) => {
      return b.eth - a.eth;
    });

    // update our state
    app.setState({});

    if (eventList.length > 0) {
      var recentEvent = eventList[0];
      var oldestEvent = eventList[eventList.length - 1];

      var dateKeyToVolumeMap = {};

      var dateKeyToEthLiquidityMap = {};
      var dateKeyToTokenLiquidityMap = {};

      // get the timestamp for the most recent block
      web3.web3js.eth.getBlock(recentEvent.block).then(function(recentBlock) {
        var mostRecentBlockTimestamp = recentBlock.timestamp;
        var mostRecentBlockNum = recentBlock.number;

        // get the timestamp for the oldest block
        web3.web3js.eth.getBlock(oldestEvent.block).then(function(oldestBlock) {
          // only continue if the current exchange is the original symbol we requested
          if (curSymbol !== tokenSymbol) {
            return;
          }

          var oldestBlockTimestamp = oldestBlock.timestamp;
          var oldestBlockNum = oldestBlock.number;

          var blockBounds = mostRecentBlockNum - oldestBlockNum;
          var timestampBoundsInSeconds =
            mostRecentBlockTimestamp - oldestBlockTimestamp;

          // now we have our bounds. determine a timestamp for each of the block numbers in the event list
          eventList.forEach(e => {
            var blockRatio =
              blockBounds > 0 ? (e.block - oldestBlockNum) / blockBounds : 1;

            var blockTimestampInSeconds =
              blockRatio * timestampBoundsInSeconds + oldestBlockTimestamp;

            // calculate which date time this block number falls under
            var blockDay = new Date(blockTimestampInSeconds * 1000);

            var dateKey =
              blockDay.getMonth() +
              "-" +
              blockDay.getDate() +
              "-" +
              blockDay.getFullYear();

            // console.log(e.block + "  " + oldestBlockNum  + "  " + dateKey + "  " + e.volume);//+ "  "  + mostRecentBlockNum + "   " + blockRatio + "  " + dateKey);

            // update volume bucket for this date
            if (e.volume > 0) {
              if (!(dateKey in dateKeyToVolumeMap)) {
                dateKeyToVolumeMap[dateKey] = 0;
              }
              dateKeyToVolumeMap[dateKey] += e.volume;
            }

            // update eth liquidity bucket for this date
            if (e.numEth !== 0) {
              if (!(dateKey in dateKeyToEthLiquidityMap)) {
                dateKeyToEthLiquidityMap[dateKey] = 0;
              }

              dateKeyToEthLiquidityMap[dateKey] += e.numEth;
            }

            // update token liquidity bucket for this date
            if (e.numTokens !== 0) {
              if (!(dateKey in dateKeyToTokenLiquidityMap)) {
                dateKeyToTokenLiquidityMap[dateKey] = 0;
              }

              dateKeyToTokenLiquidityMap[dateKey] += e.numTokens;
            }
          });

          volumeDataMap = dateKeyToVolumeMap;

          ethLiquidityDataMap = dateKeyToEthLiquidityMap;
          tokenLiquidityDataMap = dateKeyToTokenLiquidityMap;

          didReceiveData = true;

          app.setState({});
        });
      });
    } else {
      didReceiveData = true;

      app.setState({});
    }
  });

  app.setState({});
};

export default App;
