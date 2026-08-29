#!/usr/bin/env ruby
# frozen_string_literal: true

require 'yaml'

root = File.expand_path('flows', __dir__)
files = Dir[File.join(root, '**', '*.yaml')].sort
errors = []

def each_command(value, &block)
  case value
  when Array
    value.each { |entry| each_command(entry, &block) }
  when Hash
    yield value
    value.each_value { |entry| each_command(entry, &block) }
  when String
    yield value
  end
end

files.each do |file|
  begin
    documents = YAML.load_stream(File.read(file))
  rescue Psych::SyntaxError => error
    errors << "#{file}: invalid YAML: #{error.message}"
    next
  end

  config = documents[0]
  commands = documents[1]
  errors << "#{file}: missing appId config document" unless config.is_a?(Hash) && config['appId'].is_a?(String)
  errors << "#{file}: missing command document" unless commands.is_a?(Array)
  next unless commands.is_a?(Array)

  recording_depth = 0
  each_command(commands) do |command|
    recording_depth += 1 if command.is_a?(Hash) && command.key?('startRecording')
    recording_depth -= 1 if command == 'stopRecording' || (command.is_a?(Hash) && command.key?('stopRecording'))
    errors << "#{file}: stopRecording appears before startRecording" if recording_depth.negative?

    next unless command.is_a?(Hash) && command.key?('runFlow')

    run_flow = command['runFlow']
    relative_path = run_flow.is_a?(String) ? run_flow : run_flow.is_a?(Hash) ? run_flow['file'] : nil
    next unless relative_path
    next if relative_path.include?('${')

    target = File.expand_path(relative_path, File.dirname(file))
    errors << "#{file}: runFlow target does not exist: #{relative_path}" unless File.file?(target)
  end

  errors << "#{file}: unbalanced startRecording/stopRecording" unless recording_depth.zero?
end

unless errors.empty?
  warn errors.join("\n")
  exit 1
end

puts "Validated #{files.length} Maestro flows, configs, includes, and recording pairs."
