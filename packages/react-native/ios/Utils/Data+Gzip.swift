
import Foundation
import zlib

extension Data {
    func gzip() -> Data? {
        return self.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) -> Data? in
            var stream = z_stream()
            stream.next_in = UnsafeMutablePointer<Bytef>(mutating: bytes.bindMemory(to: Bytef.self).baseAddress)
            stream.avail_in = uint(self.count)
            stream.total_out = 0
            
            // 16 + MAX_WBITS = gzip header
            if deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, MAX_WBITS + 16, 8, Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) != Z_OK {
                return nil
            }
            
            var compressedData = Data(capacity: self.count / 2)
            let chunkSize = 16384
            
            repeat {
                if Int(stream.total_out) >= compressedData.count {
                    compressedData.count += chunkSize
                }
                
                compressedData.withUnsafeMutableBytes { (outBytes: UnsafeMutableRawBufferPointer) in
                    stream.next_out = outBytes.bindMemory(to: Bytef.self).baseAddress!.advanced(by: Int(stream.total_out))
                    stream.avail_out = uint(outBytes.count - Int(stream.total_out))
                    
                    deflate(&stream, Z_FINISH)
                }
            } while stream.avail_out == 0
            
            deflateEnd(&stream)
            compressedData.count = Int(stream.total_out)
            return compressedData
        }
    }
}
