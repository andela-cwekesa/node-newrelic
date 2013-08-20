'use strict';

var path            = require('path')
  , chai            = require('chai')
  , expect          = chai.expect
  , helper          = require(path.join(__dirname, 'lib', 'agent_helper'))
  , web             = require(path.join(__dirname, '..', 'lib', 'transaction', 'web'))
  , recordMemcached = require(path.join(__dirname, '..', 'lib', 'metrics',
                                        'recorders', 'memcached'))
  , Transaction     = require(path.join(__dirname, '..', 'lib', 'transaction'))
  ;

function makeSegment(options) {
  var segment = options.transaction.getTrace().root.add('Memcache/set');
  segment.setDurationInMillis(options.duration);
  segment._setExclusiveDurationInMillis(options.exclusive);

  return segment;
}

function record(options) {
  if (options.apdexT) options.transaction.metrics.apdexT = options.apdexT;

  var segment = makeSegment(options)
    , root    = options.transaction.getTrace().root
    ;

  web.normalizeAndName(root, options.url, options.code);
  recordMemcached(segment, options.transaction.scope);
}

describe("recordMemcached", function () {
  var agent
    , trans
    ;

  beforeEach(function () {
    agent = helper.loadMockedAgent();
    trans = new Transaction(agent);
  });

  afterEach(function () {
    helper.unloadAgent(agent);
  });

  describe("when scope is undefined", function () {
    var segment;

    beforeEach(function () {
      segment = makeSegment({
        transaction : trans,
        duration : 0,
        exclusive : 0
      });
    });

    it("shouldn't crash on recording", function () {
      expect(function () { recordMemcached(segment, undefined); }).not.throws();
    });

    it("should record no scoped metrics", function () {
      recordMemcached(segment, undefined);

      var result = [
        [{name : "Memcache/set"},      [1,0,0,0,0,0]],
        [{name : "Memcache/allOther"}, [1,0,0,0,0,0]],
        [{name : "Memcache/all"},      [1,0,0,0,0,0]]
      ];

      expect(JSON.stringify(trans.metrics)).equal(JSON.stringify(result));
    });
  });

  describe("with scope", function () {
    it("should record scoped metrics", function () {
      record({
        transaction : trans,
        url : '/test',
        code : 200,
        apdexT : 10,
        duration : 26,
        exclusive : 2,
      });

      var result = [
        [{name  : "Memcache/set"},            [1,0.026,0.002,0.026,0.026,0.000676]],
        [{name  : "Memcache/allWeb"},         [1,0.026,0.002,0.026,0.026,0.000676]],
        [{name  : "Memcache/all"},            [1,0.026,0.002,0.026,0.026,0.000676]],
        [{name  : "Memcache/set",
          scope : "WebTransaction/Uri/test"}, [1,0.026,0.002,0.026,0.026,0.000676]]
      ];

      expect(JSON.stringify(trans.metrics)).equal(JSON.stringify(result));
    });
  });

  it("should report exclusive time correctly", function () {
    var root   = trans.getTrace().root
      , parent = root.add('Memcache/get',     recordMemcached)
      , child1 = parent.add('Memcache/set',   recordMemcached)
      , child2 = parent.add('Memcache/clear', recordMemcached)
      ;

    root.setDurationInMillis(26, 0);
    parent.setDurationInMillis(26, 0);
    child1.setDurationInMillis(12, 3);
    child2.setDurationInMillis(8, 25);

    trans.end();

    var result = [
      [{name : "Memcache/get"},      [1,0.026,0.013,0.026,0.026,0.000676]],
      [{name : "Memcache/allOther"}, [3,0.046,0.033,0.008,0.026,0.000884]],
      [{name : "Memcache/all"},      [3,0.046,0.033,0.008,0.026,0.000884]],
      [{name : "Memcache/set"},      [1,0.012,0.012,0.012,0.012,0.000144]],
      [{name : "Memcache/clear"},    [1,0.008,0.008,0.008,0.008,0.000064]]
    ];

    expect(JSON.stringify(trans.metrics)).equal(JSON.stringify(result));
  });
});
