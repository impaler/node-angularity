'use strict';

var path = require('path');

var helper = require('../helpers/angularity-test');

var fastIt = helper.jasmineFactory({
  before: 0,
  after : 500
});

xdescribe('The Angularity cli interface', function () {

  beforeEach(helper.getTimeoutSwitch(60000));

  afterEach(helper.getTimeoutSwitch());

  afterEach(helper.cleanUp);

  xdescribe('should exit cleanly where there are no other arguments', function (done) {
    helper.runner.create()
      .addInvocation()
      .forEach(fastIt(expectations))
      .finally(done);

    function expectations(testCase) {
      expect(testCase.exitcode).toBeFalsy();
      expect(testCase.stdout).toMatch(/\s*/);
      expect(testCase.stderr).toMatch(/\s*/);
    }
  });

  xdescribe('should display help where requested', function (done) {
    helper.runner.create()
      .addInvocation('--help')
      .addInvocation('-h')
//    .addInvocation('-?')  // TODO @bholloway process cannot be spawned on windows when it has -? flag
      .forEach(fastIt(expectations))
      .finally(done);

    function expectations(testCase) {
      // test the help message begins with the description from the package.json
      var description = require(path.resolve('package.json')).description;
      expect(testCase.stderr).toMatch(new RegExp('^\\s*' + description));
    }
  });

  xdescribe('should display version where requested', function (done) {
    helper.runner.create()
      .addInvocation('--version')
      .addInvocation('-v')
      .forEach(fastIt(expectations))
      .finally(done);

    function expectations(testCase) {
      var version = require(path.resolve('package.json')).version;
      expect(testCase.stdout).toMatch(new RegExp('^angularity\\:\\s*' + version));
    }
  });
});