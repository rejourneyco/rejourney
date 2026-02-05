import UIKit
import Accelerate

extension UIImage {
    /// Apply Gaussian blur to the image
    func gaussianBlur(radius: CGFloat) -> UIImage? {
        guard let cgImage = cgImage else { return nil }
        
        let inputRadius: CGFloat = radius * scale
        let sqrtPi: CGFloat = sqrt(2.0 * CGFloat.pi)
        let radiusCalc: CGFloat = inputRadius * 3.0 * sqrtPi / 4.0 + 0.5
        var kernelRadius: UInt32 = UInt32(floor(radiusCalc))
        if kernelRadius % 2 != 1 { kernelRadius += 1 }
        
        var inputBuffer = vImage_Buffer()
        var outputBuffer = vImage_Buffer()
        
        let width = vImagePixelCount(cgImage.width)
        let height = vImagePixelCount(cgImage.height)
        let rowBytes = cgImage.bytesPerRow
        
        let inputData = UnsafeMutableRawPointer.allocate(byteCount: Int(height) * rowBytes, alignment: MemoryLayout<UInt8>.alignment)
        defer { inputData.deallocate() }
        
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(
            data: inputData,
            width: Int(width),
            height: Int(height),
            bitsPerComponent: 8,
            bytesPerRow: rowBytes,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { return nil }
        
        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
        
        inputBuffer.data = inputData
        inputBuffer.width = width
        inputBuffer.height = height
        inputBuffer.rowBytes = rowBytes
        
        let outputData = UnsafeMutableRawPointer.allocate(byteCount: Int(height) * rowBytes, alignment: MemoryLayout<UInt8>.alignment)
        defer { outputData.deallocate() }
        
        outputBuffer.data = outputData
        outputBuffer.width = width
        outputBuffer.height = height
        outputBuffer.rowBytes = rowBytes
        
        var err = vImageBoxConvolve_ARGB8888(&inputBuffer, &outputBuffer, nil, 0, 0, kernelRadius, kernelRadius, nil, vImage_Flags(kvImageEdgeExtend))
        guard err == kvImageNoError else { return nil }
        
        err = vImageBoxConvolve_ARGB8888(&outputBuffer, &inputBuffer, nil, 0, 0, kernelRadius, kernelRadius, nil, vImage_Flags(kvImageEdgeExtend))
        guard err == kvImageNoError else { return nil }
        
        err = vImageBoxConvolve_ARGB8888(&inputBuffer, &outputBuffer, nil, 0, 0, kernelRadius, kernelRadius, nil, vImage_Flags(kvImageEdgeExtend))
        guard err == kvImageNoError else { return nil }
        
        guard let outputCtx = CGContext(
            data: outputData,
            width: Int(width),
            height: Int(height),
            bitsPerComponent: 8,
            bytesPerRow: rowBytes,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { return nil }
        
        guard let blurredCGImage = outputCtx.makeImage() else { return nil }
        return UIImage(cgImage: blurredCGImage, scale: scale, orientation: imageOrientation)
    }
}
